const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
    console.log(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    errors.push(err.message);
    console.log(`[PAGE ERROR] ${err.message}`);
  });

  // Test with file:// protocol (no server!)
  await page.goto('file:///mnt/nas3/eunsu/tool_collab/chatvis_standalone.html', { timeout: 15000 });
  await page.waitForTimeout(5000);

  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));

  console.log('\n--- BODY TEXT ---');
  console.log(bodyText || '(empty)');
  console.log('\n--- ERRORS ---');
  console.log(errors.length ? errors.join('\n') : '(none)');

  await browser.close();
})();
