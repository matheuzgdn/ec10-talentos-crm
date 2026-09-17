import puppeteer from "puppeteer";

const port = process.argv[2];
const phone = String(process.argv[3] || "").replace(/\D/g, "");
const requestedBody = process.argv.slice(4).join(" ").trim();
const findOnly = requestedBody.startsWith("find:");
const testBody = findOnly ? requestedBody.slice(5) : requestedBody;
if (!port || !phone) throw new Error("Usage: node diagnose-whatsapp-send.mjs <port> <phone>");

const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
try {
  const pages = await browser.pages();
  const page = pages.find((candidate) => candidate.url().includes("web.whatsapp.com"));
  if (!page) throw new Error("WhatsApp Web page not found");

  const result = await page.evaluate(async ({ targetPhone, testBody, findOnly }) => {
    const requestedId = `${targetPhone}@c.us`;
    const wid = window.require("WAWebWidFactory").createWid(requestedId);
    const exists = await window.require("WAWebQueryExistsJob").queryWidExists(wid).catch(() => null);
    const resolvedId = exists?.wid?._serialized || null;
    const ids = [...new Set([resolvedId, requestedId].filter(Boolean))];
    const chats = [];

    for (const id of ids) {
      const chat = await window.WWebJS.getChat(id, { getAsModel: false }).catch(() => null);
      chats.push({
        id,
        found: Boolean(chat),
        chatId: chat?.id?._serialized || null,
        lastMessage: chat?.lastReceivedKey?._serialized || chat?.lastMessage?.id?._serialized || null,
      });
    }

    let sendResult = null;
    if (testBody) {
      const targetId = resolvedId || requestedId;
      const chat = await window.WWebJS.getChat(targetId, { getAsModel: false });
      const sent = findOnly ? null : await window.WWebJS.sendMessage(chat, testBody, { waitUntilMsgSent: true });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const allMessages = window.require("WAWebCollections").Msg.models || [];
      const matching = allMessages.filter((message) => (
        message?.id?.fromMe === true
        && String(message?.body || "").trim() === testBody
      )).slice(-5);
      sendResult = {
        returned: Boolean(sent),
        findOnly,
        id: sent?.id?._serialized || null,
        body: sent?.body || null,
        ack: sent?.ack ?? null,
        matching: matching.map((message) => ({
          id: message?.id?._serialized || null,
          to: message?.to?._serialized || null,
          ack: message?.ack ?? null,
          timestamp: message?.t || null,
        })),
      };
    }

    return {
      url: location.href,
      title: document.title,
      requestedId,
      resolvedId,
      chats,
      sendResult,
    };
  }, { targetPhone: phone, testBody, findOnly });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.disconnect();
}
