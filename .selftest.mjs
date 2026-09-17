import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const error = (m) => { console.error('FAIL:', m); process.exit(1); };
const results = [];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ acceptDownloads: true });
  page.on('pageerror', (e) => error(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console.error:', m.text()); });

  const downloads = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));

  await page.goto(BASE, { waitUntil: 'networkidle' });

  // Draw a part so the stock plan populates.
  await page.getByRole('button', { name: 'Part', exact: true }).click().catch(() => {});
  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox()) ?? error('no canvas bbox');
  const x0 = box.x + box.width * 0.35;
  const y0 = box.y + box.height * 0.4;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 260, y0 + 130, { steps: 12 });
  await page.mouse.up();
  results.push('drew a part (stock plan should populate)');
  await page.waitForTimeout(400);

  const stockHeading = page.getByRole('heading', { name: 'Stock plan' });
  if (!(await stockHeading.isVisible().catch(() => false))) error('no "Stock plan" heading after drawing part');
  results.push('Stock plan heading visible');

  const buyHeader = page.getByRole('columnheader', { name: 'Buy', exact: true });
  if (!(await buyHeader.isVisible().catch(() => false))) error('no "Buy" column header in stock table');
  results.push('Stock plan table has "Buy" column');

  const buyRows = await page
    .locator('table:has( thead tr:has-text("Buy") ) tbody tr:not(.category)')
    .count()
    .catch(() => -1);
  if (buyRows < 1) error('Stock plan table has no buy rows after drawing a part');
  results.push(`stock plan buy rows: ${buyRows}`);

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const csvItem = page.getByRole('menuitem', { name: /CSV lists/ });
  if (!(await csvItem.isVisible().catch(() => false))) error('no "CSV lists" export menu item');
  results.push('CSV export menu item present');
  await csvItem.click();
  await page.waitForTimeout(150);
  if (downloads.length === 0) error('no CSV download fired');
  results.push(`CSV download fired: ${downloads[0]}`);

  await browser.close();
  console.log('ALL OK');
  console.log(results.join('\n'));
})().catch((e) => error(e.stack || String(e)));
