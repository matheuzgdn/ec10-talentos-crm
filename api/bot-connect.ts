export default async function handler(_request: any, response: any) {
  response.setHeader("cache-control", "no-store, max-age=0");
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.status(200).send(`<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Conectar WhatsApp EC10</title>
    <style>
      :root{color-scheme:dark;font-family:Inter,system-ui,sans-serif}*{box-sizing:border-box}
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050b15;color:#f8fafc}
      main{width:min(560px,calc(100% - 28px));padding:28px;border:1px solid #213047;border-radius:24px;background:#0b1625;text-align:center;box-shadow:0 30px 90px #0009}
      h1{margin:0 0 8px;font-size:26px}p{margin:0 0 18px;color:#b9c7da;line-height:1.5}
      img{display:block;width:min(420px,100%);aspect-ratio:1;margin:0 auto 16px;padding:12px;border-radius:20px;background:#fff}
      #status{display:inline-flex;align-items:center;gap:9px;padding:10px 14px;border-radius:999px;background:#172337;color:#dce8f8;font-weight:700}
      #dot{width:10px;height:10px;border-radius:50%;background:#f59e0b;box-shadow:0 0 18px #f59e0b}
      .ready #dot{background:#22c55e;box-shadow:0 0 18px #22c55e}.ready img{display:none}
      small{display:block;margin-top:15px;color:#8292a8}
    </style>
  </head>
  <body>
    <main id="card">
      <h1>Conectar WhatsApp comercial</h1>
      <p>No celular, abra <strong>Aparelhos conectados</strong> e leia o código. Ele é atualizado automaticamente.</p>
      <img id="qr" alt="QR Code atualizado do WhatsApp EC10" />
      <div id="status"><span id="dot"></span><span id="label">Aguardando leitura do QR</span></div>
      <small>Não feche esta tela até aparecer “WhatsApp conectado”.</small>
    </main>
    <script>
      const qr=document.getElementById('qr');const card=document.getElementById('card');const label=document.getElementById('label');
      function refreshQr(){qr.src='/api/bot-qr?instanceId=main&t='+Date.now()}
      async function refreshStatus(){
        try{const r=await fetch('/api/bot-status?instanceId=main&t='+Date.now(),{cache:'no-store'});const s=await r.json();
          if(s.status==='ready'||s.status==='authenticated'){card.classList.add('ready');label.textContent='WhatsApp conectado';return}
          card.classList.remove('ready');label.textContent='Aguardando leitura do QR';
        }catch{label.textContent='Atualizando conexão…'}
      }
      refreshQr();refreshStatus();setInterval(refreshQr,8000);setInterval(refreshStatus,4000);
    </script>
  </body>
</html>`);
}
