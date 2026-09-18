function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderPage(title: string, message: string, ok: boolean) {
  const color = ok ? "#22c55e" : "#ef4444";
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #07111f; color: #f8fafc; }
      main { width: min(520px, calc(100% - 40px)); padding: 32px; border: 1px solid #243244; border-radius: 20px; background: #0d1a2b; box-shadow: 0 24px 80px #0008; }
      .status { width: 14px; height: 14px; border-radius: 999px; background: ${color}; box-shadow: 0 0 24px ${color}; }
      h1 { margin: 18px 0 10px; font-size: 28px; }
      p { margin: 0; color: #cbd5e1; line-height: 1.6; }
    </style>
  </head>
  <body>
    <main>
      <div class="status" aria-hidden="true"></div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
    </main>
  </body>
</html>`;
}

async function exchangeCode(code: string) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error("META_APP_ID ou META_APP_SECRET ausente.");

  const url = new URL("https://graph.facebook.com/v25.0/oauth/access_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("code", code);

  const result = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok || !payload?.access_token) {
    throw new Error("A Meta recusou a conclusao do cadastro incorporado.");
  }

  return true;
}

export default async function handler(request: any, response: any) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method !== "GET") {
    return response.status(405).json({ error: "Metodo nao permitido." });
  }

  const metaError = String(request.query?.error_description ?? request.query?.error ?? "");
  if (metaError) {
    return response
      .status(400)
      .send(renderPage("Cadastro não concluído", "A Meta interrompeu a vinculação. Volte ao cadastro e tente novamente.", false));
  }

  const code = String(request.query?.code ?? "").trim();
  if (!code) {
    return response
      .status(200)
      .send(renderPage("Integração EC10", "Esta rota recebe com segurança o retorno do cadastro oficial do WhatsApp.", true));
  }

  try {
    await exchangeCode(code);
    return response
      .status(200)
      .send(renderPage("WhatsApp conectado", "A autorização foi validada. Você já pode fechar esta janela e voltar ao CRM da EC10.", true));
  } catch {
    return response
      .status(502)
      .send(renderPage("Validação pendente", "Não foi possível validar a autorização agora. Nenhum token foi exibido ou salvo no navegador.", false));
  }
}
