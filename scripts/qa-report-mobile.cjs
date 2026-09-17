const path = require("node:path");
const puppeteer = require("puppeteer");

const email = process.env.QA_EMAIL;
const password = process.env.QA_PASSWORD;

if (!email || !password) {
  throw new Error("QA_EMAIL and QA_PASSWORD are required");
}

const sizes = [
  { name: "iphone-se", width: 375, height: 667 },
  { name: "iphone-15", width: 393, height: 852 },
  { name: "android", width: 360, height: 800 },
];

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setViewport(sizes[0]);
  await page.goto("https://ec10talentos.com/Relatorios", { waitUntil: "networkidle2" });
  if (page.url().includes("/login")) {
    await page.type('input[type="email"]', email);
    await page.type('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => location.pathname !== "/login", { timeout: 30_000 });
    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  if (!page.url().includes("/Relatorios")) {
    await page.goto("https://ec10talentos.com/Relatorios", { waitUntil: "networkidle2" });
  }
  await page.waitForSelector("h1", { timeout: 20_000 });

  const results = [];
  for (const size of sizes) {
    await page.setViewport(size);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const metrics = await page.evaluate(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const overflowing = [...document.querySelectorAll("body *")]
        .filter(visible)
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < -1 || rect.right > innerWidth + 1;
        })
        .slice(0, 20)
        .map((element) => ({ tag: element.tagName, className: String(element.className).slice(0, 120) }));
      return {
        width: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        overflowing,
        visibleTables: [...document.querySelectorAll("table")].filter(visible).length,
        selectWidths: [...document.querySelectorAll("select")].filter(visible).map((element) => Math.round(element.getBoundingClientRect().width)),
        h1Visible: [...document.querySelectorAll("h1")].some(visible),
        reportTextPresent: document.body.innerText.includes("Fechamento Eurocamp LATAM") && document.body.innerText.includes("Auditoria do grupo WhatsApp"),
      };
    });
    const output = path.join(__dirname, "..", "reports", `qa-report-${size.name}.png`);
    await page.screenshot({ path: output, fullPage: true });
    results.push({ name: size.name, screenshot: output, ...metrics });
  }

  console.log(JSON.stringify({ url: page.url(), results, errors: errors.slice(0, 20) }, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
