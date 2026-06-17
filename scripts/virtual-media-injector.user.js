// ==UserScript==
// @name         Virtual Media Injector
// @namespace    http://tampermonkey.net/
// @icon         data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%3E%3Crect%20x='2'%20y='5'%20width='14'%20height='14'%20rx='2'%20fill='%23e53935'/%3E%3Cpath%20d='M16%209l6-3v12l-6-3z'%20fill='%23e53935'/%3E%3C/svg%3E
// @version      2026.06.17.2
// @description  Floating button that plays a pre-recorded mp4 into your webcam + mic for a meeting (overrides getUserMedia with a virtual stream you can toggle live)
// @author       KakkoiDev
// @match        *://*/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      www.w3schools.com
// @license      MIT
// ==/UserScript==

// A userscript cannot create OS-level virtual devices (that needs native
// software like OBS Virtual Cam). What it can do is override
// navigator.mediaDevices.getUserMedia so the meeting app receives a synthetic
// MediaStream instead of real hardware.
//
// To allow a live mid-call toggle, we hand the app ONE stable stream we own:
//   - video track  = canvas.captureStream(), the canvas drawing either the real
//     camera (passthrough) or the mp4, per a `playing` flag.
//   - audio track  = a WebAudio MediaStreamDestination fed by either the real
//     mic or the mp4 (gain crossfade).
// The app never re-acquires; only the content of those tracks changes.
//
// The mp4 is fetched via GM_xmlhttpRequest (not a cross-origin <video src>):
// the sample files send no Access-Control-Allow-Origin, so a cross-origin video
// would taint captureStream() and WebRTC would drop the track. Blob -> object
// URL gives a same-origin, untainted source. The GM grant sandboxes the script,
// so the override must target unsafeWindow's navigator (the page's real one).

(function() {
    'use strict';

    const MP4_URL = 'https://www.w3schools.com/html/mov_bbb.mp4';
    const FALLBACK_W = 1280;
    const FALLBACK_H = 720;

    const w = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    const md = w.navigator && w.navigator.mediaDevices;
    if (!md || typeof md.getUserMedia !== 'function') return;

    const orig = md.getUserMedia.bind(md);

    const state = {
        mp4Url: null,     // object URL for the fetched mp4
        playing: false,
        ctx: null,
        micGain: null,
        clipGain: null,
        vTrack: null,     // canvas captureStream video track (master)
        aTrack: null,     // WebAudio destination audio track (master)
        mp4El: null,
        btn: null,
    };

    function fetchMp4() {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: MP4_URL,
                responseType: 'blob',
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300 && res.response) {
                        resolve(w.URL.createObjectURL(res.response));
                    } else {
                        reject(new Error('mp4 fetch status ' + res.status));
                    }
                },
                onerror: () => reject(new Error('mp4 fetch error')),
            });
        });
    }

    function makeMp4Element(url) {
        const v = document.createElement('video');
        v.src = url;
        v.loop = false;
        v.playsInline = true;
        v.preload = 'auto';
        return new Promise((resolve) => {
            if (v.readyState >= 1) return resolve(v);
            v.addEventListener('loadedmetadata', () => resolve(v), { once: true });
            v.load();
        });
    }

    function buildVideoTrack(realStream) {
        const realEl = document.createElement('video');
        realEl.muted = true;
        realEl.playsInline = true;
        realEl.srcObject = realStream;
        realEl.play().catch(() => {});

        const canvas = document.createElement('canvas');
        const ctx2d = canvas.getContext('2d');

        const sizeFrom = () => {
            const rw = realEl.videoWidth, rh = realEl.videoHeight;
            canvas.width = rw || FALLBACK_W;
            canvas.height = rh || FALLBACK_H;
        };
        sizeFrom();
        realEl.addEventListener('loadedmetadata', sizeFrom, { once: true });

        const draw = () => {
            const src = state.playing ? state.mp4El : realEl;
            if (src && src.readyState >= 2) {
                try {
                    ctx2d.drawImage(src, 0, 0, canvas.width, canvas.height);
                } catch (e) { /* not yet drawable */ }
            }
            w.requestAnimationFrame(draw);
        };
        w.requestAnimationFrame(draw);

        return canvas.captureStream(30).getVideoTracks()[0];
    }

    function buildAudioTrack(realStream) {
        const ctx = new (w.AudioContext || w.webkitAudioContext)();
        const dest = ctx.createMediaStreamDestination();

        const micGain = ctx.createGain();
        micGain.gain.value = 1;
        micGain.connect(dest);
        if (realStream.getAudioTracks().length) {
            ctx.createMediaStreamSource(realStream).connect(micGain);
        }

        const clipGain = ctx.createGain();
        clipGain.gain.value = 0;
        clipGain.connect(dest);
        // createMediaElementSource detaches the element's default speaker output
        // (so the clip is never audible locally) and routes it into our graph.
        // Drawing the same element to the canvas is unaffected.
        ctx.createMediaElementSource(state.mp4El).connect(clipGain);

        state.ctx = ctx;
        state.micGain = micGain;
        state.clipGain = clipGain;

        // The context starts suspended under the autoplay policy; until it runs,
        // even the mic passthrough is silent. Resume eagerly, and again on the
        // first user gesture anywhere (a resume needs user activation).
        const resume = () => { if (ctx.state === 'suspended') ctx.resume(); };
        resume();
        w.document.addEventListener('pointerdown', resume, { once: true, capture: true });
        w.document.addEventListener('keydown', resume, { once: true, capture: true });

        return dest.stream.getAudioTracks()[0];
    }

    // Audio and video pipelines are built independently and lazily. Apps like
    // Google Meet request audio and video in SEPARATE getUserMedia calls, so a
    // single cached build would virtualize only the first one. Each ensure*()
    // runs once and survives across calls.
    let mp4Ready = null;
    function ensureMp4() {
        if (!mp4Ready) {
            mp4Ready = (async () => {
                state.mp4Url = await fetchMp4();
                state.mp4El = await makeMp4Element(state.mp4Url);
                state.mp4El.addEventListener('ended', stopClip);
                console.log('[VMI] mp4 ready, readyState=', state.mp4El.readyState);
            })();
        }
        return mp4Ready;
    }

    let videoReady = null;
    function ensureVideo(realStream) {
        if (!videoReady) {
            videoReady = (async () => {
                await ensureMp4();
                state.vTrack = buildVideoTrack(realStream);
                mountButton();
                console.log('[VMI] video pipeline built');
            })();
        }
        return videoReady;
    }

    let audioReady = null;
    function ensureAudio(realStream) {
        if (!audioReady) {
            audioReady = (async () => {
                await ensureMp4();
                state.aTrack = buildAudioTrack(realStream);
                mountButton();
                console.log('[VMI] audio pipeline built');
            })();
        }
        return audioReady;
    }

    function setClipActive(active) {
        state.playing = active;
        if (state.ctx) {
            const t = state.ctx.currentTime;
            const mic = state.micGain.gain, clip = state.clipGain.gain;
            mic.cancelScheduledValues(t); clip.cancelScheduledValues(t);
            mic.linearRampToValueAtTime(active ? 0 : 1, t + 0.02);
            clip.linearRampToValueAtTime(active ? 1 : 0, t + 0.02);
        }
        if (state.btn) state.btn.textContent = active ? 'Stop clip' : 'Play clip';
    }

    function stopClip() {
        if (state.mp4El) state.mp4El.pause();
        setClipActive(false);
    }

    function toggleClip() {
        console.log('[VMI] toggle clicked. mp4El=', !!state.mp4El, 'vTrack=', !!state.vTrack, 'aTrack=', !!state.aTrack, 'ctx=', state.ctx && state.ctx.state, 'playing=', state.playing);
        if (!state.mp4El) return;
        if (state.playing) { stopClip(); return; }
        if (state.ctx && state.ctx.state === 'suspended') state.ctx.resume();
        state.mp4El.currentTime = 0;
        state.mp4El.play().catch(() => {});
        setClipActive(true);
    }

    function mountButton() {
        if (state.btn) return;
        const attach = () => {
            if (!document.body) return false;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = 'Play clip';
            btn.style.cssText = [
                'position:fixed', 'bottom:16px', 'right:16px', 'z-index:2147483647',
                'padding:10px 14px', 'border:none', 'border-radius:8px',
                'background:#e53935', 'color:#fff', 'font:600 13px system-ui,sans-serif',
                'box-shadow:0 2px 8px rgba(0,0,0,.3)', 'cursor:pointer',
            ].join(';');
            btn.addEventListener('click', (e) => { e.preventDefault(); toggleClip(); });
            document.body.appendChild(btn);
            state.btn = btn;
            return true;
        };
        if (!attach()) {
            w.addEventListener('DOMContentLoaded', attach, { once: true });
        }
    }

    async function wrappedGetUserMedia(constraints) {
        constraints = constraints || {};
        const wantVideo = !!constraints.video;
        const wantAudio = !!constraints.audio;
        console.log('[VMI] getUserMedia called video=' + wantVideo + ' audio=' + wantAudio, constraints);

        let realStream;
        try {
            realStream = await orig(constraints);
        } catch (e) {
            console.warn('[VMI] real getUserMedia rejected', e);
            throw e;
        }

        const tracks = [];
        if (wantVideo) { await ensureVideo(realStream); if (state.vTrack) tracks.push(state.vTrack.clone()); }
        if (wantAudio) { await ensureAudio(realStream); if (state.aTrack) tracks.push(state.aTrack.clone()); }
        if (!tracks.length) return realStream; // nothing of ours matched

        console.log('[VMI] returning virtual stream tracks=', tracks.map((t) => t.kind));
        return new w.MediaStream(tracks);
    }

    console.log('[VMI] override installed on', location.href);
    md.getUserMedia = wrappedGetUserMedia;
    // Some apps read the legacy alias; point it at the same wrapper.
    if (w.navigator.getUserMedia) {
        w.navigator.getUserMedia = function(constraints, ok, err) {
            wrappedGetUserMedia(constraints).then(ok, err);
        };
    }
})();
