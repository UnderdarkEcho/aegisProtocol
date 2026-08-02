/**
 * Headless capture for critic loops.
 * Usage: node critic/capture.mjs
 * Requires: npm run dev on :5173, playwright installed.
 */
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'captures');
await mkdir(outDir, { recursive: true });

const url = process.env.AEGIS_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.error('PAGEERROR', e.message));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);

await page.screenshot({
  path: path.join(outDir, '01-briefing.png'),
  animations: 'disabled',
  timeout: 15000,
});
console.log('01-briefing');

await page.click('#btn-deploy');
await page.waitForTimeout(1500);
await page.evaluate(() => window.__aegis.pause(true));

const simple = await page.evaluate(() => window.__aegis.captureSimple());
await writeFile(
  path.join(outDir, '02-tactical.png'),
  Buffer.from(simple.split(',')[1], 'base64'),
);
console.log('02-tactical');

const client = await page.context().newCDPSession(page);
await page.evaluate(() => window.__aegis.captureSimple());
const hud = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
await writeFile(path.join(outDir, '03-hud.png'), Buffer.from(hud.data, 'base64'));
console.log('03-hud');

await browser.close();
console.log('Done →', outDir);
