# Privacy Policy - Notion Comment Recovery

_Last updated: 2026-07-24_

Notion Comment Recovery is a browser extension that shows and recovers the comments Notion stores for the Notion page you are viewing.

## What it does with data

- It reads the current page's comment and discussion data from **Notion's own API** (`notion.so` / `notion.com`), using **your existing logged-in Notion session** (cookies). It requests nothing from any other server.
- It displays that data in a panel and can **export** it to a Markdown file that is downloaded **to your own device**.
- On your explicit action, it can **restore** a deleted block or **re-attach** a comment - these are writes to **your own Notion workspace**, through Notion's API, nowhere else.
- It keeps a small **local cache** in your browser (`localStorage`) of comments seen while you browse, so a comment can still be recovered after it is deleted. This cache **never leaves your browser** and is cleared when you clear the site's data.

## What it does NOT do

- It does **not** collect, store on any external server, or transmit any of your data to the developer or any third party.
- It contains **no** analytics, tracking, advertising, or telemetry.
- It requests **no** special browser permissions and runs **only** on Notion pages.

## Contact

Questions or issues: open an issue at <https://github.com/KakkoiDev/tampermonkey-scripts>.
