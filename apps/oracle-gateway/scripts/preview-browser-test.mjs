import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.GATEWAY_PUBLIC_ORIGIN || "https://crm-api.147-15-27-235.nip.io";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => errors.push(`${request.url()} ${request.failure()?.errorText}`));
  const response = await page.goto(`${origin}/crm`, { waitUntil: "networkidle", timeout: 30_000 });
  assert.equal(response?.status(), 200);
  await page.waitForTimeout(1000);
  const body = (await page.locator("body").innerText()).slice(0, 500);
  assert.match(body, /Acesso ao manager|Entrar/i);
  await page.screenshot({ path: "tmp/ec10-emergency-crm-login.png", fullPage: true });
  console.log(JSON.stringify({ ok: true, title: await page.title(), body, errors }));
} finally {
  await browser.close();
}
