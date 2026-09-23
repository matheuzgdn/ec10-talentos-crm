(() => {
  const BASE = "http://127.0.0.1:3219";
  const BUSINESS_NAMES = ["EC10 TALENTOS", "EC10 Talentos"];
  const baseline = new Map();
  let secret = "";
  let busy = false;
  let started = false;
  let includeExisting = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalize = value => String(value || "").replace(/\s+/g, " ").trim();
  const digits = value => String(value || "").replace(/\D/g, "");

  function badge(text, state = "ok") {
    let element = document.querySelector("#ec10-bridge-status");
    if (!element) { element = document.createElement("div"); element.id = "ec10-bridge-status"; document.body.appendChild(element); }
    element.dataset.state = state; element.textContent = text;
  }

  async function api(path, options = {}) {
    if (!secret) {
      const bootstrap = await fetch(`${BASE}/bootstrap`, { cache: "no-store" });
      if (!bootstrap.ok) throw new Error("bridge_bootstrap_failed");
      secret = (await bootstrap.json()).secret;
    }
    const response = await fetch(`${BASE}${path}`, { ...options, headers: { "content-type": "application/json", "x-ec10-bridge-secret": secret, ...(options.headers || {}) } });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(value.error || `bridge_${response.status}`);
    return value;
  }

  function unreadRows() {
    return Array.from(document.querySelectorAll('[data-testid^="list-item-"][role="row"]')).filter(row => row.querySelector('[data-testid="icon-unread-count"]'));
  }

  function rowKey(row) {
    const title = normalize(row.querySelector('[data-testid="cell-frame-title"]')?.textContent);
    const preview = normalize(row.querySelector('[data-testid="cell-frame-secondary"]')?.textContent);
    return { title, preview, fingerprint: `${title}|${preview}` };
  }

  function snapshotUnread() {
    for (const row of unreadRows()) { const item = rowKey(row); baseline.set(item.title, item.fingerprint); }
  }

  function extractConversation() {
    const composer = document.querySelector('[data-testid="conversation-compose-box-input"]');
    if (!composer) return null;
    const label = composer.getAttribute("aria-label") || "";
    const labelTarget = label.replace(/^.*?\bpara\s+/i, "").replace(/^.*?\bto\s+/i, "");
    let phone = digits(labelTarget);
    const messages = Array.from(document.querySelectorAll('[data-pre-plain-text]')).slice(-24).map(element => {
      const pre = element.getAttribute("data-pre-plain-text") || "";
      const container = element.closest('[data-testid="msg-container"]');
      const outbound = Boolean(container?.querySelector('[data-icon="tail-out"]')) || BUSINESS_NAMES.some(name => pre.includes(name));
      return { direction: outbound ? "outbound" : "inbound", text: normalize(element.innerText || element.textContent), pre };
    }).filter(item => item.text);
    const header = normalize(document.querySelector('header [data-testid="conversation-info-header-chat-title"]')?.textContent || labelTarget);
    if (phone.length < 10) {
      const sender = [...messages].reverse().find(item => item.direction === "inbound")?.pre || "";
      const candidate = digits(sender.replace(/^\[[^\]]+\]\s*/, ""));
      if (candidate.length >= 10) phone = candidate;
    }
    return { composer, phone, displayName: header, messages };
  }

  async function discoverPhone(conversation) {
    if (conversation.phone.length >= 10) return conversation.phone;
    const profile = document.querySelector('[title="Dados do perfil"],[aria-label="Dados do perfil"]');
    if (!profile) return "";
    profile.click(); await sleep(700);
    const drawer = document.querySelector('[data-testid="drawer-right"]') || Array.from(document.querySelectorAll('[data-testid^="drawer-"]')).at(-1);
    const panelText = normalize(drawer?.innerText || "");
    const matches = panelText.match(/\+\d[\d ()-]{8,20}/g) || [];
    const phone = digits(matches.at(-1) || "");
    const close = Array.from(document.querySelectorAll('button[aria-label="Fechar"],button[aria-label="Close"]')).at(-1);
    close?.click(); await sleep(250);
    return phone;
  }

  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter ? setter.call(input, value) : (input.value = value);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  }

  async function sendText(text) {
    const composer = document.querySelector('[data-testid="conversation-compose-box-input"]');
    if (!composer) throw new Error("composer_missing");
    composer.focus(); document.execCommand("selectAll", false); document.execCommand("insertText", false, text);
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    await sleep(120);
    const send = document.querySelector('button[aria-label="Enviar"],button[aria-label="Send"]');
    if (send) send.click(); else composer.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 }));
    await sleep(500);
  }

  async function sendAudio(key) {
    const response = await fetch(`${BASE}/audio/${encodeURIComponent(key)}`, { headers: { "x-ec10-bridge-secret": secret } });
    if (!response.ok) throw new Error("approved_audio_unavailable");
    const blob = await response.blob();
    document.querySelector('button[aria-label="Anexar"],button[aria-label="Attach"]')?.click(); await sleep(250);
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    const input = inputs.find(item => /audio|video/.test(item.accept || "")) || inputs.at(-1);
    if (!input) throw new Error("audio_file_input_missing");
    const file = new File([blob], `${key}.ogg`, { type: "audio/ogg" }); const transfer = new DataTransfer(); transfer.items.add(file);
    input.files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true }));
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(200); const send = document.querySelector('button[aria-label="Enviar"],button[aria-label="Send"]');
      if (send) { send.click(); await sleep(700); return; }
    }
    throw new Error("audio_send_button_missing");
  }

  async function openSeller(phone) {
    const search = document.querySelector('input[aria-label="Pesquisar ou começar uma nova conversa"],input[aria-label="Search or start a new chat"]');
    if (!search) throw new Error("search_missing");
    search.focus(); setInputValue(search, `+${phone}`); await sleep(900);
    const candidates = Array.from(document.querySelectorAll('[data-testid^="list-item-"][role="row"]'));
    const row = candidates.find(item => digits(item.textContent).includes(phone.slice(-9))) || candidates[0];
    if (!row) throw new Error("seller_chat_not_found");
    row.click(); await sleep(500); setInputValue(search, "");
  }

  async function deliverNotification() {
    const notification = await api("/notification");
    if (!notification.key) return false;
    try { await openSeller(notification.phone); await sendText(notification.text); await api("/notification/ack", { method: "POST", body: JSON.stringify({ key: notification.key, ok: true }) }); }
    catch (error) { await api("/notification/ack", { method: "POST", body: JSON.stringify({ key: notification.key, ok: false, error: error.message }) }); throw error; }
    return true;
  }

  async function processRow(row) {
    const before = rowKey(row); row.click(); await sleep(600);
    const conversation = extractConversation(); if (!conversation) return;
    conversation.phone = await discoverPhone(conversation);
    const latest = conversation.messages.at(-1); if (!latest || latest.direction !== "inbound") return;
    badge(`Gustavo analisando ${before.title}`, "working");
    const result = await api("/turn", { method: "POST", body: JSON.stringify(conversation) });
    if (result.ignored || (result.cached && result.sent)) return;
    await sleep(2500);
    await sendText(result.text);
    if (result.audioKey) await sendAudio(result.audioKey);
    await api("/ack", { method: "POST", body: JSON.stringify({ messageId: result.messageId, clientId: result.clientId, phone: result.phone, text: result.text, audioKey: result.audioKey }) });
    baseline.set(before.title, before.fingerprint);
  }

  async function cycle() {
    if (busy || !started) return;
    busy = true;
    try {
      const rows = unreadRows();
      const candidate = rows.find(row => { const item = rowKey(row); return includeExisting || baseline.get(item.title) !== item.fingerprint; });
      if (candidate) await processRow(candidate); else if (await deliverNotification()) badge("Vendedor avisado", "ok"); else badge("Gustavo ativo — aguardando mensagens", "ok");
    } catch (error) { console.warn("EC10 bridge", error); badge(`Gustavo em espera: ${error.message}`, "error"); }
    finally { busy = false; }
  }

  chrome.storage.onChanged.addListener(changes => { if (changes.includeExisting) includeExisting = Boolean(changes.includeExisting.newValue); });
  chrome.storage.local.get({ includeExisting: false }, async settings => {
    includeExisting = Boolean(settings.includeExisting); snapshotUnread();
    try { await api("/health"); started = true; badge("Gustavo ativo — aguardando mensagens", "ok"); setInterval(cycle, 3000); }
    catch (error) { badge("Ponte local desligada", "error"); setInterval(async () => { try { await api("/health"); started = true; } catch {} }, 5000); }
  });
})();
