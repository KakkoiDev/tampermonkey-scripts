// Print which of your scripts Greasy Fork has set up to sync (from webhook-info).
// Requires login (persisted profile).
import { launchBrowser, ensureLoggedIn, GF } from './lib.mjs';

const { browser, page } = await launchBrowser();
try {
  await ensureLoggedIn(page);
  await page.goto(`${GF}/en/users/webhook-info`, { waitUntil: 'networkidle2', timeout: 60000 });
  const txt = await page.evaluate(() => {
    const t = document.body.innerText;
    const i = t.indexOf('already set up to sync');
    return i >= 0 ? t.slice(i, i + 1200) : '(no "set up to sync" listing found)';
  });
  console.log(txt);
} finally {
  await browser.close();
}
