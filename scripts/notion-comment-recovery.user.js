// ==UserScript==
// @name         Notion Comment Recovery
// @namespace    http://tampermonkey.net/
// @icon         https://www.notion.so/front-static/favicon.ico
// @version      2026.07.23.4
// @description  Shows every comment Notion still stores for the current page - open, resolved, and comments whose block or anchor was deleted - in one floating panel, with export. Deep-scans version history to recover deleted-block comments retroactively.
// @author       KakkoiDev
// @match        https://www.notion.so/*
// @match        https://app.notion.com/*
// @match        https://*.notion.so/*
// @grant        none
// @run-at       document-start
// @license      MIT
// ==/UserScript==

// Verified live - see docs/notion-comment-api-spike.md. Data model:
//   block.discussions[] -> discussion{resolved, context(anchor), comments[]} -> comment{text, created_by_id, created_time}
//   A block trashed inside a page keeps alive:false but its discussion+comment records stay fetchable by id.
//
// Enumerating every comment on a page uses FOUR sources (all via cookies, no token):
//   1. Live tree  (/api/v3/loadCachedPageChunkV2) -> alive blocks' discussions[]  = open + resolved.
//   2. Page block `format.orphaned_discussions`     = some anchor-removed cases.
//   3. Version history (getSnapshotsList + getSnapshotContents) -> discussion ids referenced by ANY block
//      in ANY past snapshot; recovers comments on blocks deleted long enough ago to be snapshotted.
//   4. Passive cache: a fetch/XHR hook records every comment (+ each commented block's position) Notion
//      loads while you browse, in localStorage. This catches deletions that happen before a snapshot
//      exists - a deleted block's comment survives via live fetch, a hard-deleted comment via cached text.
//   All ids are fetched live and categorized by the CURRENT parent-block state. Cross-page cache entries
//   are dropped by walking each block's parent chain to the page (belongsToPage).
//
// Honest limits: sources 3-4 only cover comments that were snapshotted OR seen live by this script. A
// comment created and deleted before it was ever captured (no snapshot, never browsed with the script
// running) can't be recovered - nothing references it.

(function () {
    'use strict';

    if (window.top !== window.self) return;
    if (window.__NOC_ARMED__) return;
    window.__NOC_ARMED__ = true;

    const DEBUG = false;
    const TAG = '[NOC]';
    const log = (...a) => { if (DEBUG) console.log(TAG, ...a); };

    const threads = new Map();      // discussionId -> { status, anchorText, blockTitle, comments:[{id,text,author,ts}] }
    const blockPos = new Map();     // blockId -> { parentId, afterId, beforeId, ts } original position, from snapshots
    let currentPageId = null;
    let spaceId = null;
    let scanning = false;
    let deepState = 'idle';         // idle | running | done
    let loading = true;             // spin the dot from page load until the first full scan+deep finishes
    let lastHref = location.href;   // seeded so the initial scan comes only from the timeout, not the first tick
    let activeFilter = 'all';       // all | deleted | resolved | open

    // Passive cache: comments Notion loads while you browse are captured here (localStorage), so a
    // comment survives in the archive even after its block OR the comment itself is deleted - the only
    // way to catch deletions that happen before a version snapshot exists. Keyed by page id.
    const LS_KEY = 'noc:cache:v2';
    let cache = (() => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; } })();
    let saveTimer = null;
    function pageCache(pid) {
        if (!cache[pid]) cache[pid] = { d: {}, c: {}, u: {}, pos: {} };
        if (!cache[pid].pos) cache[pid].pos = {}; // migrate older cache entries
        return cache[pid];
    }
    function saveCache() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try { localStorage.setItem(LS_KEY, JSON.stringify(cache)); }
            catch (e) { // quota: drop the oldest pages and retry once
                const keys = Object.keys(cache); keys.slice(0, Math.ceil(keys.length / 2)).forEach((k) => delete cache[k]);
                try { localStorage.setItem(LS_KEY, JSON.stringify(cache)); } catch (e2) { /* give up */ }
            }
        }, 800);
    }

    // ───────────────────────── page id from url ─────────────────────────
    function pageIdFromHref(href) {
        const path = href.split('?')[0].split('#')[0].replace(/-/g, '');
        const m = path.match(/[0-9a-f]{32}/gi);
        return m && m.length ? dashify(m[m.length - 1]) : null;
    }
    function dashify(hex) {
        const h = (hex || '').replace(/-/g, '').toLowerCase();
        if (h.length !== 32) return hex;
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }

    // ───────────────────────── api (page's own fetch; cookies auth) ─────────────────────────
    async function apiPost(path, body) {
        const res = await fetch(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'notion-audit-log-platform': 'web' },
            body: JSON.stringify(body),
            credentials: 'include',
        });
        if (!res.ok) throw new Error(path + ' -> ' + res.status);
        return res.json();
    }
    const req = (table, id) => ({ pointer: { table, id }, version: -1 });

    async function syncRecords(pointers) {
        const out = { block: {}, discussion: {}, comment: {}, notion_user: {} };
        for (let i = 0; i < pointers.length; i += 80) {
            let j;
            try { j = await apiPost('/api/v3/syncRecordValues', { requests: pointers.slice(i, i + 80) }); }
            catch (e) { log('syncRecordValues failed', e.message); continue; }
            const rm = j.recordMap || {};
            for (const t of ['block', 'discussion', 'comment', 'notion_user']) if (rm[t]) Object.assign(out[t], rm[t]);
        }
        return out;
    }
    async function loadPageBlocks(pageId) {
        try {
            const j = await apiPost('/api/v3/loadCachedPageChunkV2',
                { page: { id: pageId }, cursor: { stack: [] }, verticalColumns: false });
            return (j.recordMap && j.recordMap.block) || {};
        } catch (e) { log('loadCachedPageChunkV2 failed', e.message); return {}; }
    }

    // Walk a block's parent chain to decide whether it lives on `pageId`. The passive cache picks up
    // comments from OTHER pages (backlinks, linked mentions, the inbox), so this filters them out.
    const memberMemo = new Map(); // blockId -> boolean (for the current page; cleared on page change)
    async function belongsToPage(blockId, pageId, blockCache) {
        if (memberMemo.has(blockId)) return memberMemo.get(blockId);
        const chain = [];
        let id = blockId;
        let result = false;
        for (let guard = 0; id && guard < 40; guard++) {
            if (memberMemo.has(id)) { result = memberMemo.get(id); break; }
            if (id === pageId) { result = true; break; }
            chain.push(id);
            let b = blockCache[id];
            if (!b) { const r = await syncRecords([req('block', id)]); b = val(r.block[id]); if (b) blockCache[id] = b; }
            if (!b) { result = false; break; }
            if (b.parent_table !== 'block') { result = false; break; } // top-level page/collection that isn't ours
            id = b.parent_id;
        }
        chain.forEach((c) => memberMemo.set(c, result)); // whole chain shares the verdict
        return result;
    }

    // ───────────────────────── record helpers ─────────────────────────
    const val = (e) => (e && e.value && e.value.value) || (e && e.value) || null;
    const rich = (rt) => Array.isArray(rt) ? rt.map((s) => (Array.isArray(s) ? s[0] : '')).join('') : '';
    // Notion prefixes a comment that quotes its anchor with a mention chip (renders as "‣"). Drop it.
    const cleanText = (t) => (t || '').replace(/^\s*‣\s*/, '').trim();
    const blockTitle = (b) => (b && b.properties && b.properties.title) ? rich(b.properties.title) : '';
    const fmtTs = (ms) => { try { return ms ? new Date(ms).toLocaleString() : ''; } catch (e) { return ''; } };
    // Notion keeps trashed content for a retention window that depends on the workspace plan
    // (version history ~7/30/90 days or unlimited). We can't read the plan, so assume 30 and label it
    // an estimate. moved_to_trash_time is the real start of the clock.
    const RETENTION_DAYS = 30;
    function daysLeft(trashedTime) {
        if (!trashedTime) return null;
        return RETENTION_DAYS - Math.floor((Date.now() - trashedTime) / 86400000);
    }

    // ───────────────────────── fetch + categorize a set of discussion ids ─────────────────────────
    // Upserts into `threads` (keyed by discussion id) - safe to call repeatedly (fast scan, then deep scan).
    async function buildRows(discIds, blockCache, pc) {
        if (!discIds.size) return;
        pc = pc || { d: {}, c: {}, u: {} };
        const dRes = await syncRecords([...discIds].map((id) => req('discussion', id)));
        // merge discussions: prefer the live record; fall back to the passive cache when it's gone from
        // the DB (which is what happens when the comment itself was hard-deleted).
        const discussions = {};
        for (const id of discIds) {
            const live = val(dRes.discussion[id]);
            if (live) discussions[id] = { resolved: !!live.resolved, parentBlockId: live.parent_table === 'block' ? live.parent_id : null, context: (live.context && live.context[0] && live.context[0][0]) || '', comments: live.comments || [], src: 'live' };
            else if (pc.d[id]) discussions[id] = Object.assign({ src: 'cache' }, pc.d[id]);
        }
        const commentIds = new Set();
        const needBlocks = new Set();
        for (const id in discussions) {
            (discussions[id].comments || []).forEach((c) => commentIds.add(c));
            const pb = discussions[id].parentBlockId;
            if (pb && !blockCache[pb]) needBlocks.add(pb);
        }
        const recRes = await syncRecords(
            [...commentIds].map((c) => req('comment', c)).concat([...needBlocks].map((b) => req('block', b))));
        for (const id in recRes.block) { const b = val(recRes.block[id]); if (b) blockCache[id] = b; }
        // merge comments: prefer live; fall back to cached text for purged comments
        const comments = {};
        const userIds = new Set();
        for (const cid of commentIds) {
            const live = val(recRes.comment[cid]);
            if (live) { comments[cid] = { text: rich(live.text), authorId: live.created_by_id, ts: live.created_time, src: 'live' }; if (live.created_by_id) userIds.add(live.created_by_id); }
            else if (pc.c[cid]) { comments[cid] = Object.assign({ src: 'cache' }, pc.c[cid]); if (pc.c[cid].authorId) userIds.add(pc.c[cid].authorId); }
        }
        const uRes = userIds.size ? await syncRecords([...userIds].map((u) => req('notion_user', u))) : { notion_user: {} };
        const users = {};
        for (const id in uRes.notion_user) { const u = val(uRes.notion_user[id]); if (u) users[id] = u.name || [u.given_name, u.family_name].filter(Boolean).join(' '); }
        const authorOf = (aid) => users[aid] || pc.u[aid] || 'unknown';

        // drop discussions that belong to a different page (passive cache leaks cross-page comments)
        const belongs = {};
        await Promise.all(Object.keys(discussions).map(async (did) => {
            const pbId = discussions[did].parentBlockId;
            belongs[did] = pbId ? await belongsToPage(pbId, currentPageId, blockCache) : false;
        }));

        for (const did in discussions) {
            if (!belongs[did]) continue;
            const d = discussions[did];
            const pb = d.parentBlockId ? blockCache[d.parentBlockId] : null;
            const anchoredStill = pb && Array.isArray(pb.discussions) && pb.discussions.includes(did);
            let status;
            if (d.src === 'cache') status = 'comment-deleted';        // discussion gone from DB -> comment was deleted; recovered from cache
            else if (!pb || pb.alive === false) status = 'deleted';   // block trashed (comment records survive)
            else if (d.resolved) status = 'resolved';
            else if (!anchoredStill) status = 'anchor-gone';
            else status = 'open';

            const thread = (d.comments || [])
                .map((c) => comments[c])
                .filter(Boolean)
                .sort((a, b) => (a.ts || 0) - (b.ts || 0))
                .map((c) => ({ text: cleanText(c.text), author: authorOf(c.authorId), ts: c.ts || null, purged: c.src === 'cache' }));
            if (!thread.length) continue;

            threads.set(did, {
                discussionId: did,
                blockId: d.parentBlockId,
                parentOfBlock: pb ? pb.parent_id : null,
                status,
                anchorText: d.context || '',
                blockTitle: pb ? (blockTitle(pb) || '(untitled block)') : (d.src === 'cache' ? '(comment deleted)' : '(deleted block)'),
                trashedTime: (pb && pb.moved_to_trash_time) || null, // when the block was trashed, for the purge countdown
                comments: thread,
            });
        }
    }

    // ───────────────────────── fast scan (live tree + orphaned_discussions) ─────────────────────────
    async function scan() {
        const pageId = pageIdFromHref(location.href);
        if (!pageId) { loading = false; render(); return; }
        if (scanning) return;
        scanning = true;
        currentPageId = pageId;
        render(); // reflect busy state (spinner) immediately
        try {
            const discIds = new Set();
            const blockCache = {};

            const pageRes = await syncRecords([req('block', pageId)]);
            const pageBlock = val(pageRes.block[pageId]);
            if (pageBlock) {
                blockCache[pageId] = pageBlock;
                spaceId = pageBlock.space_id || spaceId;
                const orph = pageBlock.format && pageBlock.format.orphaned_discussions;
                if (Array.isArray(orph)) orph.forEach((d) => discIds.add(d));
            }

            const liveBlocks = await loadPageBlocks(pageId);
            for (const id in liveBlocks) {
                const b = val(liveBlocks[id]);
                if (!b) continue;
                blockCache[id] = b;
                if (!spaceId && b.space_id) spaceId = b.space_id;
                if (Array.isArray(b.discussions)) b.discussions.forEach((d) => discIds.add(d));
            }

            // discussions captured passively on this page (catches recent deletions no other source has)
            const pc = pageCache(pageId);
            Object.keys(pc.d).forEach((id) => discIds.add(id));

            threads.clear();
            blockPos.clear();
            memberMemo.clear();
            deepState = 'idle';
            // seed positions captured passively (snapshots, run later, override with ts>0)
            Object.keys(pc.pos).forEach((bid) => blockPos.set(bid, Object.assign({ ts: 0 }, pc.pos[bid])));
            await buildRows(discIds, blockCache, pc);
            log('fast scan', pageId, '| threads', threads.size);
            render();
        } catch (e) {
            log('scan error', e);
        } finally {
            scanning = false;
        }
        // Deleted-block comments live only in version history - dig for them automatically.
        deepScan();
    }
    function scheduleScan() { clearTimeout(scheduleScan._t); scheduleScan._t = setTimeout(scan, 600); }

    // ───────────────────────── deep scan (version history) ─────────────────────────
    async function getSnapshotTimestamps(pageId) {
        try {
            const j = await apiPost('/api/v3/getSnapshotsList', { block: { id: pageId, spaceId }, size: 100 });
            const snaps = j.snapshots || j.results || j.list || [];
            return snaps.map((s) => s.timestamp || s.version || s.time).filter(Boolean).map(String);
        } catch (e) { log('getSnapshotsList failed', e.message); return []; }
    }
    async function discIdsFromSnapshot(pageId, ts) {
        const ids = new Set();
        try {
            const j = await apiPost('/api/v3/getSnapshotContents', { block: { id: pageId, spaceId }, timestamp: ts });
            const cm = (j.contentMap && j.contentMap.block) || {};
            const tsNum = Number(ts) || 0;
            for (const bid in cm) {
                const b = val(cm[bid]);
                if (!b) continue;
                (b.discussions || []).forEach((d) => ids.add(d));
                const orph = b.format && b.format.orphaned_discussions;
                if (Array.isArray(orph)) orph.forEach((d) => ids.add(d));
                // remember where a commented block sat in its parent, from the latest snapshot that has it
                if (b.discussions && b.discussions.length && b.parent_id) {
                    const parent = val(cm[b.parent_id]);
                    const content = parent && parent.content;
                    if (Array.isArray(content)) {
                        const idx = content.indexOf(bid);
                        const prev = blockPos.get(bid);
                        if (idx >= 0 && (!prev || tsNum > prev.ts)) {
                            blockPos.set(bid, {
                                parentId: b.parent_id,
                                afterId: idx > 0 ? content[idx - 1] : null,
                                beforeId: idx < content.length - 1 ? content[idx + 1] : null,
                                ts: tsNum,
                            });
                        }
                    }
                }
            }
        } catch (e) { /* skip this snapshot */ }
        return ids;
    }
    async function deepScan() {
        const pageId = currentPageId || pageIdFromHref(location.href);
        if (!pageId || deepState === 'running') return;
        if (!spaceId) { // ensure spaceId
            try { const r = await syncRecords([req('block', pageId)]); const pb = val(r.block[pageId]); if (pb) spaceId = pb.space_id; } catch (e) { /* */ }
        }
        deepState = 'running'; render();
        try {
            const timestamps = await getSnapshotTimestamps(pageId);
            log('deep scan: snapshots', timestamps.length);
            const allIds = new Set();
            // small concurrency pool over snapshots
            let i = 0;
            const worker = async () => {
                while (i < timestamps.length) {
                    const ts = timestamps[i++];
                    const ids = await discIdsFromSnapshot(pageId, ts);
                    ids.forEach((d) => allIds.add(d));
                }
            };
            await Promise.all([worker(), worker(), worker(), worker()]);
            log('deep scan: discussion ids found', allIds.size);
            await buildRows(allIds, {}, pageCache(pageId)); // parent blocks fetched fresh -> categorized by current state; upserts into threads
            deepState = 'done';
            loading = false;
            render();
        } catch (e) {
            log('deep scan error', e);
            deepState = 'done';
            loading = false;
            render();
        }
    }

    // ───────────────────────── UI ─────────────────────────
    const THEME = {
        surface: '#252525', text: '#e9e9e7', sub: '#9b9a97',
        border: 'rgba(255,255,255,.09)', hover: 'rgba(255,255,255,.06)',
        accent: '#2383e2', green: '#4dab6d', amber: '#d9a441', red: '#eb5757',
        radius: '10px', font: "ui-sans-serif,-apple-system,'Segoe UI',Roboto,sans-serif",
    };
    const STATUS_META = {
        deleted: { label: 'deleted block', cls: 'r' },
        'comment-deleted': { label: 'deleted comment', cls: 'r' },
        'anchor-gone': { label: 'anchor removed', cls: 'a' },
        resolved: { label: 'resolved', cls: 's' },
        open: { label: 'open', cls: 'g' },
    };
    const HIDDEN = (s) => s === 'deleted' || s === 'comment-deleted' || s === 'anchor-gone';

    function injectStyle() {
        if (document.getElementById('noc-style')) return;
        const s = document.createElement('style');
        s.id = 'noc-style';
        s.textContent = `
#noc-root{position:fixed;top:52px;right:12px;z-index:2147483647;font-family:${THEME.font};
  display:flex;flex-direction:column;align-items:flex-end;}
#noc-badge{all:unset;display:inline-flex;align-items:center;gap:7px;cursor:pointer;padding:6px 11px;
  border-radius:999px;background:${THEME.surface};color:${THEME.text};border:1px solid ${THEME.border};
  box-shadow:0 2px 10px rgba(0,0,0,.35);font-size:13px;}
#noc-badge:hover{background:${THEME.hover};}
#noc-badge .noc-dot{width:8px;height:8px;border-radius:50%;background:${THEME.green};box-sizing:border-box;}
#noc-badge .noc-dot.noc-spin{background:transparent!important;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;animation:noc-spin .7s linear infinite;}
@keyframes noc-spin{to{transform:rotate(360deg);}}
#noc-badge .noc-n{font-weight:600;}
.noc-panel{display:none;margin-top:8px;width:380px;max-height:72vh;overflow:auto;background:${THEME.surface};
  color:${THEME.text};border:1px solid ${THEME.border};border-radius:${THEME.radius};box-shadow:0 8px 28px rgba(0,0,0,.5);}
.noc-panel.noc-open{display:block;}
.noc-head{display:flex;align-items:center;gap:6px;padding:10px 12px;position:sticky;top:0;z-index:2;background:${THEME.surface};
  border-bottom:1px solid ${THEME.border};font-size:12px;color:${THEME.sub};flex-wrap:wrap;}
.noc-filter{all:unset;cursor:pointer;padding:2px 7px;border-radius:6px;border:1px solid ${THEME.border};font-size:11px;}
.noc-filter.noc-on{background:${THEME.accent};border-color:${THEME.accent};color:#fff;}
.noc-row{padding:10px 12px;border-bottom:1px solid ${THEME.border};}
.noc-text{font-size:13px;line-height:1.45;color:${THEME.text};white-space:pre-wrap;
  display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;}
.noc-cmt{margin-top:8px;padding-left:9px;border-left:2px solid ${THEME.border};}
.noc-cmt-head{font-size:11px;color:${THEME.sub};display:flex;gap:6px;margin-bottom:2px;}
.noc-cmt-author{font-weight:600;color:${THEME.text};}
.noc-meta{margin-top:2px;font-size:11px;color:${THEME.sub};display:flex;flex-wrap:wrap;align-items:center;gap:6px;}
.noc-pill{padding:1px 7px;border-radius:6px;font-weight:600;color:#111;}
.noc-pill.g{background:${THEME.green};}.noc-pill.a{background:${THEME.amber};}
.noc-pill.r{background:${THEME.red};color:#fff;}.noc-pill.s{background:${THEME.border};color:${THEME.text};}
.noc-anchor{font-style:italic;opacity:.85;}
.noc-copy{all:unset;margin-left:auto;cursor:pointer;color:${THEME.sub};padding:2px 7px;border-radius:6px;}
.noc-copy:hover{background:${THEME.hover};color:${THEME.text};}
.noc-act{all:unset;cursor:pointer;color:${THEME.sub};padding:2px 7px;border-radius:6px;border:1px solid ${THEME.border};font-size:11px;}
.noc-act:hover{background:${THEME.hover};color:${THEME.text};}
.noc-act[disabled]{opacity:.5;cursor:default;}
.noc-meta .noc-act:first-of-type{margin-left:auto;}
.noc-foot{position:sticky;bottom:0;z-index:2;display:flex;gap:8px;padding:10px 12px;background:${THEME.surface};border-top:1px solid ${THEME.border};}
.noc-btn{all:unset;cursor:pointer;flex:1;text-align:center;padding:7px 0;border-radius:7px;font-size:12px;border:1px solid ${THEME.border};color:${THEME.text};}
.noc-btn:hover{background:${THEME.hover};}.noc-btn.pri{background:${THEME.accent};border-color:${THEME.accent};color:#fff;}
.noc-btn[disabled]{opacity:.5;cursor:default;}
.noc-empty{padding:24px 12px;text-align:center;color:${THEME.sub};font-size:12px;}`;
        (document.head || document.documentElement).appendChild(s);
    }

    function mk(tag, a, b) {
        const el = document.createElement(tag);
        if (b === undefined) el.textContent = a; else { el.className = a; el.textContent = b; }
        return el;
    }

    function ensurePanel() {
        if (document.getElementById('noc-root') || !document.body) return;
        const root = document.createElement('div'); root.id = 'noc-root';

        const badge = document.createElement('button'); badge.id = 'noc-badge'; badge.type = 'button';
        badge.setAttribute('aria-label', 'Page comment archive');
        const dot = mk('span', 'noc-dot', '');
        if (loading || scanning || deepState === 'running') dot.classList.add('noc-spin'); // spin from first paint
        badge.append(dot, mk('span', 'noc-n', '0 comments'));

        const panel = document.createElement('div'); panel.className = 'noc-panel';
        const head = document.createElement('div'); head.className = 'noc-head';
        head.appendChild(mk('span', 'This page'));
        ['all', 'deleted', 'resolved', 'open'].forEach((f) => {
            const b = document.createElement('button');
            b.className = 'noc-filter' + (f === activeFilter ? ' noc-on' : '');
            b.textContent = f; b.dataset.f = f;
            b.addEventListener('click', () => { activeFilter = f; render(); });
            head.appendChild(b);
        });
        const list = document.createElement('div'); list.className = 'noc-list';
        const foot = document.createElement('div'); foot.className = 'noc-foot';
        const refresh = mk('button', 'noc-btn', 'Refresh'); refresh.addEventListener('click', scan);
        const exp = mk('button', 'noc-btn pri', 'Export'); exp.id = 'noc-export'; exp.addEventListener('click', exportAll);
        foot.append(refresh, exp);
        panel.append(head, list, foot);

        badge.addEventListener('click', () => panel.classList.toggle('noc-open'));
        root.append(badge, panel);
        document.body.appendChild(root);

        document.addEventListener('click', (e) => {
            if (panel.classList.contains('noc-open') && !root.contains(e.target)) panel.classList.remove('noc-open');
        }, true);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') panel.classList.remove('noc-open'); });
    }

    function threadTs(t) { return t.comments.length ? t.comments[t.comments.length - 1].ts || 0 : 0; }
    function threadsForFilter() {
        const rank = { deleted: 0, 'comment-deleted': 1, 'anchor-gone': 2, open: 3, resolved: 4 };
        const all = [...threads.values()].sort((a, b) => ((rank[a.status] ?? 9) - (rank[b.status] ?? 9)) || (threadTs(b) - threadTs(a)));
        if (activeFilter === 'all') return all;
        if (activeFilter === 'deleted') return all.filter((t) => HIDDEN(t.status));
        return all.filter((t) => t.status === activeFilter);
    }
    function commentCount() { let n = 0; threads.forEach((t) => { n += t.comments.length; }); return n; }

    function render() {
        ensurePanel();
        const root = document.getElementById('noc-root'); if (!root) return;
        const rows = threadsForFilter();
        const deleted = [...threads.values()].filter((t) => HIDDEN(t.status)).length;
        const busy = loading || scanning || deepState === 'running';
        const total = commentCount();
        root.querySelector('.noc-n').textContent = total + (total === 1 ? ' comment' : ' comments');
        const dot = root.querySelector('#noc-badge .noc-dot');
        dot.style.background = deleted ? THEME.red : THEME.green;
        dot.classList.toggle('noc-spin', busy);
        root.querySelectorAll('.noc-filter').forEach((b) => b.classList.toggle('noc-on', b.dataset.f === activeFilter));

        const exp = root.querySelector('#noc-export');
        if (exp) {
            exp.textContent = rows.length ? `Export ${activeFilter} (${rows.length})` : 'Export';
            exp.disabled = !rows.length;
        }

        const list = root.querySelector('.noc-list');
        list.textContent = '';
        if (!rows.length) {
            const msg = deepState === 'running' ? 'Scanning version history for deleted-block comments…'
                : threads.size ? 'No comments in this filter.'
                : 'No comments found for this page.';
            list.appendChild(mk('div', 'noc-empty', msg));
            return;
        }
        rows.forEach((t) => list.appendChild(renderThread(t)));
    }

    // one card per discussion thread: block/anchor header, then every comment joined in order
    function renderThread(t) {
        const row = document.createElement('div'); row.className = 'noc-row';
        const head = document.createElement('div'); head.className = 'noc-meta';
        const sm = STATUS_META[t.status] || { label: t.status, cls: 's' };
        head.appendChild(mk('span', 'noc-pill ' + sm.cls, sm.label));
        if (t.status === 'deleted' && t.trashedTime) {
            const dl = daysLeft(t.trashedTime);
            const cls = dl <= 3 ? 'r' : dl <= 7 ? 'a' : 'g';
            const pill = mk('span', 'noc-pill ' + cls, dl > 0 ? `~${dl} day${dl === 1 ? '' : 's'} left` : 'purge imminent');
            pill.title = `Block trashed ${fmtTs(t.trashedTime)}. Est. permanent deletion in ~${Math.max(0, dl)} day(s), assuming ${RETENTION_DAYS}-day retention (varies by Notion plan).`;
            head.appendChild(pill);
        }
        head.appendChild(mk('span', t.blockTitle));
        if (t.anchorText) head.appendChild(mk('span', 'noc-anchor', '"' + t.anchorText.slice(0, 40) + '"'));
        if (t.comments.length > 1) head.appendChild(mk('span', t.comments.length + ' replies'));

        // "Go" only makes sense when there's a live location to jump to.
        if (t.status !== 'deleted' && t.status !== 'comment-deleted' && t.blockId) {
            const go = mk('button', 'noc-act', 'Go →');
            go.title = 'Open this comment in Notion';
            go.addEventListener('click', () => goToComment(t));
            head.appendChild(go);
        }

        if (t.status === 'deleted' && t.blockId) {
            const restore = mk('button', 'noc-act', 'Restore block');
            restore.title = 'Undelete the block so the comment reappears inline';
            restore.addEventListener('click', () => restoreBlock(t, restore));
            head.appendChild(restore);
        }

        const copy = mk('button', 'noc-act', 'Copy');
        copy.addEventListener('click', () => copyText(formatThread(t)));
        head.appendChild(copy);
        row.appendChild(head);

        t.comments.forEach((c) => {
            const cmt = document.createElement('div'); cmt.className = 'noc-cmt';
            const ch = document.createElement('div'); ch.className = 'noc-cmt-head';
            ch.appendChild(mk('span', 'noc-cmt-author', c.author || 'unknown'));
            if (c.ts) ch.appendChild(mk('span', '· ' + fmtTs(c.ts)));
            cmt.appendChild(ch);
            cmt.appendChild(mk('div', 'noc-text', c.text || '(empty)'));
            row.appendChild(cmt);
        });
        return row;
    }

    // ───────────────────────── export ─────────────────────────
    // one thread as markdown (used by per-thread Copy and the file export)
    function formatThread(t) {
        const sm = STATUS_META[t.status] || { label: t.status };
        const dl = (t.status === 'deleted' && t.trashedTime) ? daysLeft(t.trashedTime) : null;
        const left = dl != null ? ` - ~${Math.max(0, dl)} day(s) left` : '';
        const head = `## [${sm.label}${left}] ${t.blockTitle}${t.anchorText ? ' - anchor: "' + t.anchorText + '"' : ''}`;
        const body = t.comments.map((c) =>
            `- **${c.author || 'unknown'}**${c.ts ? ' - ' + fmtTs(c.ts) : ''}\n\n  ${(c.text || '').replace(/\n/g, '\n  ')}`).join('\n');
        return head + '\n' + body;
    }
    function exportAll() {
        const rows = threadsForFilter();
        if (!rows.length) return;
        const title = (document.title || 'Notion page').replace(/\s*\|\s*Notion.*$/i, '').trim() || 'Notion page';
        const comments = rows.reduce((n, t) => n + t.comments.length, 0);
        const doc = `# Comments - ${title}\n\n` +
            `_Filter: ${activeFilter} - ${rows.length} thread(s), ${comments} comment(s)_\n\n` +
            rows.map(formatThread).join('\n\n---\n\n') + '\n';
        const slug = (title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page').slice(0, 60);
        downloadFile(`notion-comments-${slug}-${activeFilter}.md`, doc);
    }
    function downloadFile(name, text) {
        const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ───────────────────────── navigate + restore ─────────────────────────
    // Notion deep-links a comment as <pagePath>?d=<discussionId>#<blockId> (ids without dashes).
    function commentUrl(t) {
        const disc = (t.discussionId || '').replace(/-/g, '');
        const blk = (t.blockId || '').replace(/-/g, '');
        return location.origin + location.pathname + '?d=' + disc + (blk ? '#' + blk : '');
    }
    function goToComment(t) {
        const el = t.blockId && document.querySelector('[data-block-id="' + t.blockId + '"]');
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const prev = el.style.boxShadow;
            el.style.transition = 'box-shadow .25s';
            el.style.boxShadow = '0 0 0 3px ' + THEME.accent;
            setTimeout(() => { el.style.boxShadow = prev; }, 1600);
            const panel = document.querySelector('#noc-root .noc-panel');
            if (panel) panel.classList.remove('noc-open'); // get the panel out of the way
            return;
        }
        location.href = commentUrl(t); // block not rendered (virtualized/far) - fall back to Notion's deep link
    }

    // Restore a trashed block: flip alive back on and re-attach it to its parent's content list.
    // This is a WRITE to the workspace - gated behind a confirm().
    async function restoreBlock(t, btn) {
        if (!t.blockId) { return; }
        if (!window.confirm('Restore the deleted block for this comment? It will be re-added to the page and the comment will reappear inline.')) return;
        const orig = btn.textContent;
        btn.disabled = true; btn.textContent = 'Restoring…';
        try {
            const txId = crypto.randomUUID();
            const reqId = crypto.randomUUID();
            const ops = [{ pointer: { table: 'block', id: t.blockId, spaceId }, path: [], command: 'update', args: { alive: true } }];
            // put it back where it was: after its former previous sibling (from snapshots), else before the
            // next one, else fall back to the end of the parent.
            const pos = blockPos.get(t.blockId);
            const parentId = (pos && pos.parentId) || t.parentOfBlock;
            if (parentId) {
                const p = { pointer: { table: 'block', id: parentId, spaceId }, path: ['content'] };
                if (pos && pos.afterId) ops.push({ ...p, command: 'listAfter', args: { after: pos.afterId, id: t.blockId } });
                else if (pos && pos.beforeId) ops.push({ ...p, command: 'listBefore', args: { before: pos.beforeId, id: t.blockId } });
                else ops.push({ ...p, command: 'listAfter', args: { id: t.blockId } });
            }
            // re-register the discussion on the block so the inline comment re-anchors (the block's
            // annotated title survives a block delete, so this brings the anchor back with it)
            if (t.discussionId) {
                ops.push({ pointer: { table: 'block', id: t.blockId, spaceId }, path: ['discussions'], command: 'listAfter', args: { id: t.discussionId } });
            }
            await apiPost('/api/v3/saveTransactionsFanout',
                { requestId: reqId, transactions: [{ id: txId, spaceId, debug: { userAction: 'NocRestoreBlock' }, operations: ops }] });
            btn.textContent = 'Restored ✓';
            setTimeout(scan, 900);
        } catch (e) {
            log('restore failed', e);
            btn.disabled = false; btn.textContent = 'Restore failed - retry';
            void orig;
        }
    }
    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
        else fallbackCopy(text);
    }
    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e) { /* ignore */ }
        ta.remove();
    }

    // ───────────────────────── tick (SPA nav + self-heal) ─────────────────────────
    function tick() {
        if (!document.body) return;
        injectStyle();
        ensurePanel();
        if (location.href !== lastHref) {
            lastHref = location.href;
            const pid = pageIdFromHref(location.href);
            if (pid && pid !== currentPageId) { threads.clear(); blockPos.clear(); memberMemo.clear(); deepState = 'idle'; loading = true; render(); scheduleScan(); }
        }
    }
    // ───────────────────────── passive capture (hook Notion's own fetches) ─────────────────────────
    function harvest(recordMap) {
        if (!recordMap || typeof recordMap !== 'object') return;
        const pid = pageIdFromHref(location.href);
        if (!pid) return;
        const pc = pageCache(pid);
        let changed = false;
        for (const id in (recordMap.discussion || {})) {
            const d = val(recordMap.discussion[id]);
            if (!d) continue;
            pc.d[id] = { resolved: !!d.resolved, parentBlockId: d.parent_table === 'block' ? d.parent_id : null, context: (d.context && d.context[0] && d.context[0][0]) || '', comments: d.comments || [] };
            changed = true;
        }
        for (const id in (recordMap.comment || {})) {
            const c = val(recordMap.comment[id]);
            if (!c || !c.text) continue;
            pc.c[id] = { text: rich(c.text), authorId: c.created_by_id || null, ts: c.created_time || null, parentDiscId: c.parent_table === 'discussion' ? c.parent_id : null };
            changed = true;
        }
        for (const id in (recordMap.notion_user || {})) {
            const u = val(recordMap.notion_user[id]);
            if (u) { pc.u[id] = u.name || [u.given_name, u.family_name].filter(Boolean).join(' '); changed = true; }
        }
        // remember a commented block's position (parent + previous sibling) while it's alive, so a later
        // restore puts it back where it was instead of at the end of the page
        for (const id in (recordMap.block || {})) {
            const b = val(recordMap.block[id]);
            if (!b || !b.discussions || !b.discussions.length || !b.parent_id) continue;
            const parent = val((recordMap.block || {})[b.parent_id]);
            const content = parent && parent.content;
            if (!Array.isArray(content)) continue;
            const idx = content.indexOf(id);
            if (idx < 0) continue;
            pc.pos[id] = { parentId: b.parent_id, afterId: idx > 0 ? content[idx - 1] : null, beforeId: idx < content.length - 1 ? content[idx + 1] : null };
            changed = true;
        }
        if (changed) saveCache();
    }
    function scanResponse(url, text) {
        if (!text || text.charAt(0) !== '{' || !/discussion|comment/.test(text)) return;
        let j; try { j = JSON.parse(text); } catch (e) { return; }
        harvest(j.recordMap || j.recordMapWithRoles || null);
    }
    (function hookNet() {
        const of = window.fetch;
        if (typeof of === 'function' && !of.__noc) {
            const wf = function (input, init) {
                const url = typeof input === 'string' ? input : (input && input.url) || '';
                const p = of.apply(this, arguments);
                if (/\/api\/v3\//.test(url)) p.then((res) => { res.clone().text().then((t) => scanResponse(url, t)).catch(() => {}); }).catch(() => {});
                return p;
            };
            wf.__noc = true; window.fetch = wf;
        }
        const P = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
        if (P && P.open && !P.open.__noc) {
            const oo = P.open, os = P.send;
            const wo = function (m, u) { this.__nocUrl = u; return oo.apply(this, arguments); };
            wo.__noc = true; P.open = wo;
            P.send = function (body) {
                const u = this.__nocUrl || '';
                if (/\/api\/v3\//.test(u)) this.addEventListener('load', function () { let t; try { t = this.responseText; } catch (e) { t = null; } if (t) scanResponse(u, t); });
                return os.apply(this, arguments);
            };
        }
    })();

    tick();
    setInterval(tick, 1000);
    setTimeout(scan, 2500);
    log('armed');
})();
