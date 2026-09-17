const puppeteer = require('puppeteer-core');

async function main() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();
  const events = [];

  page.on('console', (message) => events.push(`console:${message.type()} ${message.text()}`));
  page.on('pageerror', (error) => events.push(`pageerror: ${error.stack || error.message}`));
  page.on('requestfailed', (request) => {
    events.push(`requestfailed: ${request.url()} ${request.failure()?.errorText || ''}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) events.push(`response:${response.status()} ${response.url()}`);
  });

  const targetUrl = process.argv[2] || `https://ec10talentos.com/crm?debug=${Date.now()}`;
  const response = await page.goto(
    targetUrl,
    { waitUntil: 'networkidle2', timeout: 45_000 },
  );
  await new Promise((resolve) => setTimeout(resolve, 3_000));

  const result = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    rootText: document.querySelector('#root')?.innerText?.slice(0, 2_000) || '',
    bodyText: document.body?.innerText?.slice(0, 2_000) || '',
    rootHtmlLength: document.querySelector('#root')?.innerHTML?.length || 0,
  }));

  console.log(JSON.stringify({ status: response?.status(), result, events }, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
