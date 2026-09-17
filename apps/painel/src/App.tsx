import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CirclePause,
  Columns3,
  Eye,
  EyeOff,
  FileText,
  Globe2,
  Headphones,
  Loader2,
  LogOut,
  MessageCircle,
  Mic,
  MoreVertical,
  Paperclip,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Smile,
  TrendingUp,
  UserCheck,
  UsersRound
} from "lucide-react";
import type { ChatMessage, ClientRecord, LeadStatus, SellerRecord, ServiceInterest } from "@crm/shared";
import { TrafficPanel } from "./TrafficPanel";

type ViewMode = "leads" | "pipeline" | "servicos" | "vendedores" | "bot" | "trafego";
type AuthMode = "login" | "signup";
type LeadFolder = "ec10" | "revela" | "todos";

type BotStatus = {
  status: string;
  updatedAt?: string;
  message?: string;
  stale?: boolean;
  source?: string;
};

type BotQr = {
  qrDataUrl?: string;
  updatedAt?: string;
};

type ClientWithPreview = ClientRecord & {
  lastMessage?: {
    body: string | null;
    direction: "inbound" | "outbound";
    mediaType: string;
    createdAt: string;
  } | null;
};

const statusLabel: Record<LeadStatus, string> = {
  novo: "Novo",
  triagem: "Triagem",
  orcamento: "Orcamento",
  aguardando_cliente: "Aguardando",
  quente: "Quente",
  fechado: "Fechado",
  perdido: "Perdido"
};

const statusFlow: LeadStatus[] = ["novo", "triagem", "orcamento", "aguardando_cliente", "quente", "fechado", "perdido"];

const serviceLabel: Record<ServiceInterest, string> = {
  plano_internacional: "Plano internacional",
  plano_carreira: "Plano de carreira",
  eurocamp: "Eurocamp",
  eurocamp_latam: "Eurocamp LATAM",
  mentoria_prime: "Mentoria Prime",
  libertacademy_florianopolis: "Libertacademy Florianopolis",
  academy_sudamerica: "Academy Sudamerica",
  ambos: "Ambos",
  nao_definido: "Nao definido"
};

const serviceOptions = Object.keys(serviceLabel) as ServiceInterest[];

const leadFolderLabel: Record<LeadFolder, string> = {
  ec10: "Pasta EC10",
  revela: "Pasta Revela Talentos",
  todos: "Todas as pastas"
};

export function App() {
  const [session, setSession] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [seller, setSeller] = useState<SellerRecord | null>(null);
  const [sellers, setSellers] = useState<SellerRecord[]>([]);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>("leads");
  const [clients, setClients] = useState<ClientWithPreview[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [leadFolder, setLeadFolder] = useState<LeadFolder>("ec10");
  const [serviceFilter, setServiceFilter] = useState<ServiceInterest | "todos">("todos");
  const [draft, setDraft] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [newClientService, setNewClientService] = useState<ServiceInterest>("plano_internacional");
  const [loadingClients, setLoadingClients] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [botQr, setBotQr] = useState<BotQr | null>(null);
  const [qrVersion, setQrVersion] = useState(Date.now());
  const [minimizedLeadIds, setMinimizedLeadIds] = useState<Set<string>>(new Set());
  const [conversationMinimized, setConversationMinimized] = useState(false);
  const [leadToolsVisible, setLeadToolsVisible] = useState(false);
  const [resettingBotIds, setResettingBotIds] = useState<Set<string>>(new Set());

  const selectedClient = clients.find((client) => client.id === selectedId) ?? clients[0] ?? null;
  const isAdmin = seller?.role === "admin";

  const metrics = useMemo(() => {
    return {
      active: clients.length,
      international: clients.filter((client) => client.serviceInterest === "plano_internacional").length,
      career: clients.filter((client) => client.serviceInterest === "plano_carreira").length,
      hot: clients.filter((client) => client.status === "quente").length,
      paused: clients.filter((client) => client.botPaused).length
    };
  }, [clients]);

  async function apiJson<T>(path: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");

    const response = await fetch(path, { ...options, headers, cache: "no-store", credentials: "include" });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error ?? (await response.text()) ?? "Falha na requisicao.");
    }
    return (await response.json()) as T;
  }

  async function loadMe(showError = false) {
    try {
      const response = await fetch("/api/me", { cache: "no-store", credentials: "include" });
      if (!response.ok) throw new Error((await response.json()).error ?? "Falha ao carregar usuario.");
      const data = (await response.json()) as { seller: SellerRecord };
      setSeller(data.seller);
      setSession(true);
    } catch (err) {
      setSession(false);
      setSeller(null);
      if (showError) setError(err instanceof Error ? err.message : "Falha ao validar login.");
    }
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthLoading(true);
    setError(null);
    setNotice(null);

    try {
      const data = await apiJson<{ seller: SellerRecord }>("/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: authMode === "signup" ? "signup" : "login", email: authEmail.trim(), password: authPassword })
      });
      setSeller(data.seller);
      setSession(true);
    } catch (err) {
      setError(normalizeAuthError(err, "Falha no login."));
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setError("Este CRM agora usa login exclusivo por e-mail e senha. O Google foi removido para nao misturar usuarios com o Revela Talentos.");
  }

  async function signOut() {
    await fetch("/api/auth", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "logout" })
    });
    setSession(false);
    setSeller(null);
    setClients([]);
    setMessages([]);
  }

  async function loadClients(nextSearch = search, nextService = serviceFilter, nextFolder = leadFolder) {
    if (!session || !seller?.active) return;
    setLoadingClients(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (nextSearch.trim()) params.set("search", nextSearch.trim());
      params.set("folder", nextFolder);
      if (nextService !== "todos") params.set("service", nextService);
      const data = await apiJson<{ clients: ClientWithPreview[] }>(`/api/clients?${params.toString()}`);
      setClients(data.clients);
      setSelectedId((current) => {
        const fallback = data.clients[0]?.id ?? null;
        if (!current) return fallback;
        return data.clients.some((client) => client.id === current) ? current : fallback;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar clientes.");
    } finally {
      setLoadingClients(false);
    }
  }

  async function loadMessages(clientId: string) {
    if (!session || conversationMinimized) return;
    try {
      const data = await apiJson<{ messages: ChatMessage[] }>(`/api/messages?clientId=${encodeURIComponent(clientId)}`);
      setMessages(data.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar conversa.");
    }
  }

  async function loadSellers() {
    if (!session || !isAdmin) return;
    try {
      const data = await apiJson<{ sellers: SellerRecord[] }>("/api/sellers");
      setSellers(data.sellers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar vendedores.");
    }
  }

  async function loadBotStatus() {
    try {
      const status = await apiJson<BotStatus>("/api/bot-status");
      setBotStatus(status);
      setBotQr(null);
      setQrVersion(Date.now());
    } catch (err) {
      setBotStatus({
        status: "offline",
        message: err instanceof Error ? err.message : "Nao foi possivel consultar o bot."
      });
    }
  }

  async function updateClient(patch: Partial<ClientRecord> & { botPaused?: boolean }) {
    if (!selectedClient) return;
    try {
      const data = await apiJson<{ client: ClientWithPreview }>("/api/update-client", {
        method: "PATCH",
        body: JSON.stringify({ clientId: selectedClient.id, ...patch })
      });
      setClients((current) => current.map((client) => (client.id === data.client.id ? { ...client, ...data.client } : client)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atualizar cliente.");
    }
  }

  async function updateClientStatus(clientId: string, status: LeadStatus) {
    try {
      const data = await apiJson<{ client: ClientWithPreview }>("/api/update-client", {
        method: "PATCH",
        body: JSON.stringify({ clientId, status })
      });
      setClients((current) => current.map((client) => (client.id === data.client.id ? { ...client, ...data.client } : client)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao mover lead.");
    }
  }

  async function resetClientBot(clientId: string) {
    if (resettingBotIds.has(clientId)) return;

    setResettingBotIds((current) => new Set(current).add(clientId));
    setError(null);
    setNotice(null);

    try {
      const data = await apiJson<{ client: ClientWithPreview }>("/api/update-client", {
        method: "PATCH",
        body: JSON.stringify({ clientId, resetBot: true })
      });
      setClients((current) => current.map((client) => (client.id === data.client.id ? { ...client, ...data.client } : client)));
      setNotice(`Bot resetado para ${data.client.name || data.client.phone}. Ele so vai iniciar quando esse contato chamar novamente.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao resetar bot.");
    } finally {
      setResettingBotIds((current) => {
        const next = new Set(current);
        next.delete(clientId);
        return next;
      });
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedClient || !draft.trim()) return;

    setSending(true);
    setError(null);
    try {
      await apiJson("/api/send-message", {
        method: "POST",
        body: JSON.stringify({ clientId: selectedClient.id, body: draft.trim(), mediaType: "text" })
      });
      setDraft("");
      await Promise.all([loadMessages(selectedClient.id), loadClients()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enfileirar mensagem.");
    } finally {
      setSending(false);
    }
  }

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newClientPhone.trim()) return;

    setError(null);
    try {
      const data = await apiJson<{ client: ClientWithPreview }>("/api/create-client", {
        method: "POST",
        body: JSON.stringify({
          name: newClientName.trim() || null,
          phone: newClientPhone.trim(),
          region: "brasil",
          serviceInterest: newClientService
        })
      });
      setNewClientName("");
      setNewClientPhone("");
      await loadClients();
      setSelectedId(data.client.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar cliente.");
    }
  }

  async function approveSeller(target: SellerRecord, active: boolean, role = target.role) {
    try {
      await apiJson("/api/approve-seller", {
        method: "PATCH",
        body: JSON.stringify({ sellerId: target.id, active, role })
      });
      await loadSellers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atualizar vendedor.");
    }
  }

  function toggleMinimizedLead(clientId: string) {
    setMinimizedLeadIds((current) => {
      const next = new Set(current);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  }

  function leadToolsStorageKey(sellerId: string) {
    return `crm:leads:tools-visible:${sellerId}`;
  }

  function toggleLeadTools() {
    setLeadToolsVisible((current) => {
      const next = !current;
      if (seller?.id) window.localStorage.setItem(leadToolsStorageKey(seller.id), String(next));
      return next;
    });
  }

  useEffect(() => {
    loadMe(false).finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (!seller?.id) return;
    setLeadToolsVisible(window.localStorage.getItem(leadToolsStorageKey(seller.id)) === "true");
  }, [seller?.id]);

  useEffect(() => {
    if (!session || !seller?.active) return;
    loadClients();
    loadBotStatus();
    if (isAdmin) loadSellers();
    const clientsTimer = window.setInterval(() => loadClients(), 15000);
    const botTimer = window.setInterval(loadBotStatus, 10000);
    return () => {
      window.clearInterval(clientsTimer);
      window.clearInterval(botTimer);
    };
  }, [session, seller?.active, seller?.role, leadFolder, serviceFilter]);

  useEffect(() => {
    if (selectedClient && !conversationMinimized) loadMessages(selectedClient.id);
  }, [selectedClient?.id, conversationMinimized]);

  if (!authChecked) {
    return (
      <main className="auth-shell">
        <div className="auth-panel">
          <MessageCircle size={34} />
          <h1>WhatsApp CRM</h1>
          <p>Validando sessao...</p>
        </div>
      </main>
    );
  }

  if (!session || !seller) {
    return (
      <AuthScreen
        mode={authMode}
        email={authEmail}
        password={authPassword}
        loading={authLoading}
        showPassword={showPassword}
        error={error}
        notice={notice}
        onModeChange={setAuthMode}
        onEmailChange={setAuthEmail}
        onPasswordChange={setAuthPassword}
        onTogglePassword={() => setShowPassword((current) => !current)}
        onSubmit={handleAuth}
      />
    );
  }

  if (!seller.active) {
    return (
      <main className="approval-shell">
        <div className="approval-panel">
          <ShieldCheck size={42} />
          <h1>Acesso aguardando aprovacao</h1>
          <p>Seu usuario ja foi criado. O administrador precisa aprovar seu vendedor antes de liberar os leads.</p>
          <span>{seller.email}</span>
          <button type="button" onClick={() => loadMe(true)}>Atualizar status</button>
          <button type="button" className="ghost-button" onClick={signOut}>Sair</button>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <MessageCircle size={24} />
          <div>
            <strong>WhatsApp CRM</strong>
            <span>{seller.role === "admin" ? "Administrador" : "Vendedor"} conectado</span>
          </div>
        </div>

        <nav className="nav">
          <button className={viewMode === "leads" ? "active" : ""} onClick={() => setViewMode("leads")}>
            <UsersRound size={18} /> Leads
          </button>
          <button className={viewMode === "pipeline" ? "active" : ""} onClick={() => setViewMode("pipeline")}>
            <Columns3 size={18} /> Pipeline
          </button>
          <button className={viewMode === "servicos" ? "active" : ""} onClick={() => setViewMode("servicos")}>
            <BriefcaseBusiness size={18} /> Servicos
          </button>
          <button className={viewMode === "trafego" ? "active" : ""} onClick={() => setViewMode("trafego")}>
            <TrendingUp size={18} /> Trafego IA
          </button>
          {isAdmin ? (
            <button className={viewMode === "vendedores" ? "active" : ""} onClick={() => { setViewMode("vendedores"); loadSellers(); }}>
              <UserCheck size={18} /> Vendedores
            </button>
          ) : null}
          <button className={viewMode === "bot" ? "active" : ""} onClick={() => setViewMode("bot")}>
            <Bot size={18} /> Bot
          </button>
        </nav>

        <button className="logout-button" type="button" onClick={signOut}>
          <LogOut size={18} /> Sair
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{pageTitle(viewMode)}</h1>
            <p>{pageSubtitle(viewMode)}</p>
          </div>
          {viewMode !== "leads" ? (
            <form className="search" onSubmit={(event) => { event.preventDefault(); loadClients(search, serviceFilter, leadFolder); }}>
              <Search size={18} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente, telefone, servico ou anotacao" />
            </form>
          ) : null}
        </header>

        {error ? <div className="error-banner">{error}</div> : null}
        {notice ? <div className="notice-banner">{notice}</div> : null}

        {viewMode === "bot" ? (
          <BotPanel botStatus={botStatus} botQr={botQr} qrVersion={qrVersion} onRefresh={loadBotStatus} />
        ) : null}

        {viewMode === "vendedores" && isAdmin ? (
          <SellersPanel sellers={sellers} onApprove={approveSeller} onRefresh={loadSellers} />
        ) : null}

        {viewMode === "servicos" ? (
          <ServicesPanel clients={clients} onFilter={(service) => { setServiceFilter(service); loadClients(search, service, leadFolder); setViewMode("leads"); }} />
        ) : null}

        {viewMode === "trafego" ? (
          <TrafficPanel isAdmin={isAdmin} />
        ) : null}

        {viewMode === "pipeline" ? (
          <PipelinePanel clients={clients} selectedId={selectedClient?.id ?? null} onSelect={setSelectedId} onMove={updateClientStatus} />
        ) : null}

        {viewMode === "leads" ? (
          <section className="wa-crm-shell">
            <aside className="wa-sidebar-panel">
              <div className="wa-sidebar-header">
                <div className="wa-user-badge">
                  <span>{getLeadInitials(seller.name || seller.email || "EC")}</span>
                </div>
                <div>
                  <strong>Leads</strong>
                  <small>{loadingClients ? "Atualizando" : `${clients.length} conversas - ${leadFolderLabel[leadFolder]}`}</small>
                </div>
                <div className="wa-header-actions">
                  <button
                    className="wa-icon-button"
                    type="button"
                    onClick={toggleLeadTools}
                    title={leadToolsVisible ? "Ocultar painel" : "Mostrar painel"}
                    aria-label={leadToolsVisible ? "Ocultar painel de filtros" : "Mostrar painel de filtros"}
                    aria-pressed={leadToolsVisible}
                  >
                    {leadToolsVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                  <button className="wa-icon-button" type="button" onClick={() => loadClients(search, serviceFilter, leadFolder)} title="Atualizar">
                    <RefreshCw size={18} className={loadingClients ? "spin" : ""} />
                  </button>
                  <button className="wa-icon-button" type="button" onClick={() => setMinimizedLeadIds(new Set(clients.map((client) => client.id)))} title="Minimizar cards">
                    <ChevronUp size={18} />
                  </button>
                  <button className="wa-icon-button" type="button" title="Mais opcoes">
                    <MoreVertical size={18} />
                  </button>
                </div>
              </div>

              <div className={`wa-sidebar-tools ${leadToolsVisible ? "visible" : "hidden"}`} aria-hidden={!leadToolsVisible}>
                {leadToolsVisible ? (
                  <>
                    <form className="wa-search" onSubmit={(event) => { event.preventDefault(); loadClients(search, serviceFilter, leadFolder); }}>
                      <Search size={17} />
                      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar ou comecar uma conversa" />
                    </form>

                    <div className="wa-filter-line">
                      <select aria-label="Pasta de leads" value={leadFolder} onChange={(event) => { const value = event.target.value as LeadFolder; setLeadFolder(value); loadClients(search, serviceFilter, value); }}>
                        <option value="ec10">{leadFolderLabel.ec10}</option>
                        <option value="revela">{leadFolderLabel.revela}</option>
                        <option value="todos">{leadFolderLabel.todos}</option>
                      </select>
                      <span className="folder-pill">{leadFolder === "revela" ? "Campanha" : "CRM"}</span>
                    </div>

                    <div className="wa-filter-line">
                      <select value={serviceFilter} onChange={(event) => { const value = event.target.value as ServiceInterest | "todos"; setServiceFilter(value); loadClients(search, value, leadFolder); }}>
                        <option value="todos">Todos os servicos</option>
                        {serviceOptions.map((service) => <option key={service} value={service}>{serviceLabel[service]}</option>)}
                      </select>
                      <span>{metrics.hot} quentes</span>
                    </div>

                    <div className="wa-mini-metrics">
                      <Metric icon={<UsersRound size={17} />} label="Leads" value={String(metrics.active)} />
                      <Metric icon={<Globe2 size={17} />} label="Internacional" value={String(metrics.international)} />
                      <Metric icon={<BriefcaseBusiness size={17} />} label="Carreira" value={String(metrics.career)} />
                      <Metric icon={<CirclePause size={17} />} label="Bot pausado" value={String(metrics.paused)} />
                    </div>

                    <details className="wa-new-lead">
                      <summary>
                        <Plus size={17} />
                        <span>Novo lead manual</span>
                      </summary>
                      <form className="new-client" onSubmit={createClient}>
                        <input value={newClientName} onChange={(event) => setNewClientName(event.target.value)} placeholder="Nome" />
                        <input value={newClientPhone} onChange={(event) => setNewClientPhone(event.target.value)} placeholder="Telefone com DDD" />
                        <select value={newClientService} onChange={(event) => setNewClientService(event.target.value as ServiceInterest)}>
                          {serviceOptions.map((service) => <option key={service} value={service}>{serviceLabel[service]}</option>)}
                        </select>
                        <button type="submit">Adicionar lead</button>
                      </form>
                    </details>
                  </>
                ) : null}
              </div>

              <div className="wa-contact-list">
                {clients.map((client) => (
                  <LeadCard
                    client={client}
                    key={client.id}
                    selected={client.id === selectedClient?.id}
                    minimized={minimizedLeadIds.has(client.id)}
                    resettingBot={resettingBotIds.has(client.id)}
                    onSelect={() => setSelectedId(client.id)}
                    onToggle={() => toggleMinimizedLead(client.id)}
                    onResetBot={() => resetClientBot(client.id)}
                  />
                ))}
                {!clients.length && !loadingClients ? <p className="empty-state">Nenhum lead ainda.</p> : null}
              </div>
            </aside>

            <LeadDetail
              client={selectedClient}
              messages={messages}
              draft={draft}
              sending={sending}
              minimized={conversationMinimized}
              onDraftChange={setDraft}
              onSubmitMessage={sendMessage}
              onToggleMinimized={() => setConversationMinimized((current) => !current)}
              onUpdate={updateClient}
              onResetBot={resetClientBot}
              resettingBot={selectedClient ? resettingBotIds.has(selectedClient.id) : false}
            />
          </section>
        ) : null}
      </section>
    </main>
  );
}

function AuthScreen({
  mode,
  email,
  password,
  loading,
  showPassword,
  error,
  notice,
  onModeChange,
  onEmailChange,
  onPasswordChange,
  onTogglePassword,
  onSubmit
}: {
  mode: AuthMode;
  email: string;
  password: string;
  loading: boolean;
  showPassword: boolean;
  error: string | null;
  notice: string | null;
  onModeChange: (mode: AuthMode) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const isBusy = loading;

  return (
    <main className="auth-shell">
      <form className="auth-panel" onSubmit={onSubmit}>
        <MessageCircle size={34} />
        <h1>WhatsApp CRM</h1>
        <p>{mode === "login" ? "Entre para operar os leads." : "Crie seu acesso exclusivo do CRM."}</p>
        {error ? <div className="error-banner">{error}</div> : null}
        {notice ? <div className="notice-banner">{notice}</div> : null}
        <label>
          E-mail
          <input type="email" autoComplete="email" value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder="voce@email.com" required />
        </label>
        <label>
          Senha
          <div className="password-field">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder="Sua senha"
              required
              minLength={6}
            />
            <button type="button" onClick={onTogglePassword} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>
        <button type="submit" disabled={isBusy}>
          {loading ? <Loader2 className="spin" size={18} /> : null}
          {loading ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar acesso"}
        </button>
        <button type="button" className="ghost-button" disabled={isBusy} onClick={() => onModeChange(mode === "signup" ? "login" : "signup")}>
          {mode === "signup" ? "Ja tenho acesso" : "Criar novo acesso"}
        </button>
      </form>
    </main>
  );
}

function PasswordUpdateScreen({
  password,
  loading,
  error,
  notice,
  onPasswordChange,
  onSubmit
}: {
  password: string;
  loading: boolean;
  error: string | null;
  notice: string | null;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <main className="auth-shell">
      <form className="auth-panel" onSubmit={onSubmit}>
        <MessageCircle size={34} />
        <h1>Definir senha</h1>
        <p>Crie uma senha para acessar o WhatsApp CRM por e-mail e senha.</p>
        {error ? <div className="error-banner">{error}</div> : null}
        {notice ? <div className="notice-banner">{notice}</div> : null}
        <label>
          Nova senha
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            placeholder="Nova senha"
            required
            minLength={6}
          />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? <Loader2 className="spin" size={18} /> : null}
          {loading ? "Salvando..." : "Salvar senha"}
        </button>
      </form>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="google-mark">
      <path fill="#EA4335" d="M12.24 10.286v3.984h5.65c-.248 1.285-.992 2.374-2.109 3.107l3.414 2.65c1.988-1.832 3.132-4.528 3.132-7.734 0-.733-.066-1.438-.187-2.121H12.24Z" />
      <path fill="#34A853" d="M12 22c2.835 0 5.215-.937 6.953-2.528l-3.414-2.65c-.948.638-2.16 1.016-3.539 1.016-2.725 0-5.034-1.842-5.858-4.318H2.615v2.733A10 10 0 0 0 12 22Z" />
      <path fill="#4A90E2" d="M6.142 13.52A5.99 5.99 0 0 1 5.814 11.6c0-.666.115-1.313.328-1.92V6.948H2.615A10 10 0 0 0 2 11.6c0 1.61.385 3.135 1.068 4.653l3.074-2.733Z" />
      <path fill="#FBBC05" d="M12 5.362c1.541 0 2.924.53 4.014 1.573l3.01-3.01C17.21 2.24 14.83 1.2 12 1.2A10 10 0 0 0 2.615 6.948L6.142 9.68C6.966 7.204 9.275 5.362 12 5.362Z" />
    </svg>
  );
}

function normalizeAuthError(error: unknown, fallback: string) {
  const rawMessage = error instanceof Error ? error.message : fallback;
  const normalized = rawMessage.toLowerCase();

  if (normalized.includes("invalid login credentials")) return "E-mail ou senha invalidos.";
  if (normalized.includes("email not confirmed")) return "Confirme seu e-mail antes de entrar.";
  if (normalized.includes("unsupported provider") || normalized.includes("provider is not enabled")) {
    return "O login com Google ainda nao esta habilitado no Supabase deste projeto.";
  }

  return rawMessage;
}

function getLeadInitials(nameOrPhone: string | null | undefined) {
  const value = (nameOrPhone ?? "").trim();
  if (!value) return "LD";
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return value.slice(0, 2).toUpperCase();
}

function formatChatTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function getPreviewText(client: ClientWithPreview) {
  if (isAudioMessageType(client.lastMessage?.mediaType)) return "Audio recebido";
  if (client.lastMessage?.body) return client.lastMessage.body;
  if (client.notes) return client.notes;
  return "Sem historico recente";
}

function isAudioMessageType(mediaType: string | null | undefined) {
  return ["audio", "ptt", "voice"].includes(String(mediaType ?? "").toLowerCase());
}

function messageLabel(message: ChatMessage) {
  if (isAudioMessageType(message.mediaType)) return "Audio";
  if (message.mediaType === "image") return "Imagem";
  if (message.mediaType === "document") return "Documento";
  if (message.mediaType === "poll") return "Enquete";
  return message.direction === "inbound" ? "Cliente" : "Atendimento";
}

function LeadCard({
  client,
  selected,
  minimized,
  resettingBot,
  onSelect,
  onToggle,
  onResetBot
}: {
  client: ClientWithPreview;
  selected: boolean;
  minimized: boolean;
  resettingBot: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onResetBot: () => void;
}) {
  const preview = getPreviewText(client);
  const time = formatChatTime(client.lastMessage?.createdAt ?? client.lastMessageAt ?? client.createdAt);
  const score = client.leadScore ?? 0;

  return (
    <article className={`wa-lead-card ${selected ? "selected" : ""} ${minimized ? "minimized" : ""}`}>
      <button className="wa-lead-main" type="button" onClick={onSelect}>
        <span className="wa-avatar">{getLeadInitials(client.name || client.phone)}</span>
        <span className="wa-lead-content">
          <span className="wa-lead-topline">
            <strong>{client.name || "Lead WhatsApp"}</strong>
            <time>{time}</time>
          </span>
          <span className="wa-lead-preview">{preview}</span>
          {!minimized ? (
            <span className="wa-lead-tags">
              <small className={`status ${client.status}`}>{statusLabel[client.status]}</small>
              <small>{serviceLabel[client.serviceInterest]}</small>
              {client.botPaused ? <small className="danger">Bot pausado</small> : null}
              {score >= 70 ? <small className="hot">Quente</small> : null}
            </span>
          ) : null}
        </span>
      </button>
      <button
        className="wa-card-action reset-bot"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onResetBot();
        }}
        disabled={resettingBot}
        title="Resetar bot deste contato"
        aria-label="Resetar bot deste contato"
      >
        {resettingBot ? <Loader2 className="spin" size={15} /> : <RotateCcw size={15} />}
      </button>
      <button className="wa-mini-toggle" type="button" onClick={onToggle} title={minimized ? "Expandir card" : "Minimizar card"}>
        {minimized ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
    </article>
  );
}

function LeadDetail({
  client,
  messages,
  draft,
  sending,
  minimized,
  onDraftChange,
  onSubmitMessage,
  onToggleMinimized,
  onUpdate,
  onResetBot,
  resettingBot
}: {
  client: ClientWithPreview | null;
  messages: ChatMessage[];
  draft: string;
  sending: boolean;
  minimized: boolean;
  onDraftChange: (value: string) => void;
  onSubmitMessage: (event: FormEvent<HTMLFormElement>) => void;
  onToggleMinimized: () => void;
  onUpdate: (patch: Partial<ClientRecord> & { botPaused?: boolean }) => void;
  onResetBot: (clientId: string) => void;
  resettingBot: boolean;
}) {
  if (!client) {
    return (
      <div className="wa-chat-panel empty">
        <MessageCircle size={58} />
        <strong>Aguardando lead</strong>
        <span>Quando uma conversa cair no WhatsApp, ela aparece aqui.</span>
      </div>
    );
  }

  return (
    <div className={`wa-chat-panel ${minimized ? "minimized" : ""}`}>
      <div className="wa-chat-header">
        <div className="wa-chat-identity">
          <span className="wa-avatar large">{getLeadInitials(client.name || client.phone)}</span>
          <div>
          <h2>{client.name || "Lead WhatsApp"}</h2>
          <span>{client.phone} - {serviceLabel[client.serviceInterest]}</span>
          </div>
        </div>
        <div className="wa-chat-actions">
          <button className="wa-icon-button" type="button" title="Ligacao">
            <Phone size={18} />
          </button>
          <button className="wa-icon-button" type="button" onClick={onToggleMinimized} title={minimized ? "Abrir conversa" : "Minimizar conversa"}>
            {minimized ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
          <button className="wa-icon-button" type="button" title="Mais opcoes">
            <MoreVertical size={18} />
          </button>
        </div>
      </div>

      <div className="wa-chat-grid lead-workspace">
        <aside className="wa-crm-drawer lead-notes">
          <div className="wa-crm-card lead-stage">
            <div className="wa-crm-title">
              <Headphones size={17} />
              <strong>CRM do lead</strong>
            </div>
            <label>
              Pipeline
              <select value={client.status} onChange={(event) => onUpdate({ status: event.target.value as LeadStatus })}>
                {statusFlow.map((status) => <option value={status} key={status}>{statusLabel[status]}</option>)}
              </select>
            </label>
            <label>
              Servico
              <select value={client.serviceInterest} onChange={(event) => onUpdate({ serviceInterest: event.target.value as ServiceInterest })}>
                {serviceOptions.map((service) => <option value={service} key={service}>{serviceLabel[service]}</option>)}
              </select>
            </label>
            <button className={client.botPaused ? "resume" : ""} type="button" onClick={() => onUpdate({ botPaused: !client.botPaused })}>
              <Bot size={17} />
              {client.botPaused ? "Retomar bot" : "Pausar bot"}
            </button>
            <button className="reset-bot-command" type="button" onClick={() => onResetBot(client.id)} disabled={resettingBot}>
              {resettingBot ? <Loader2 className="spin" size={17} /> : <RotateCcw size={17} />}
              {resettingBot ? "Resetando..." : "Resetar bot"}
            </button>
          </div>
          <label>
            Anotacoes do vendedor
            <textarea key={`notes-${client.id}`} defaultValue={client.notes ?? ""} onBlur={(event) => onUpdate({ notes: event.target.value })} placeholder="Resumo da conversa, dores, objecoes e proximo passo." />
          </label>
          <label>
            Follow-up
            <input
              key={`follow-${client.id}`}
              type="datetime-local"
              defaultValue={client.nextFollowUpAt ? client.nextFollowUpAt.slice(0, 16) : ""}
              onBlur={(event) => onUpdate({ nextFollowUpAt: event.target.value ? new Date(event.target.value).toISOString() : null })}
            />
          </label>
          <label>
            Temperatura
            <input type="range" min="0" max="100" value={client.leadScore ?? 0} onChange={(event) => onUpdate({ leadScore: Number(event.target.value) })} />
            <span>{client.leadScore ?? 0}/100</span>
          </label>
          <div className="wa-crm-card compact">
            <div className="wa-crm-title">
              <FileText size={17} />
              <strong>Origem</strong>
            </div>
            <small>{client.trafficCampaignName || client.utmCampaign || client.source || "whatsapp"}</small>
            {client.tags?.length ? <small>{client.tags.slice(0, 4).join(" - ")}</small> : null}
          </div>
        </aside>

        {!minimized ? (
          <section className="wa-message-panel conversation-thread">
            <div className="wa-messages messages">
              <span className="wa-day-pill">Hoje</span>
              {messages.map((message) => (
                <article className={`wa-bubble message ${message.direction} ${isAudioMessageType(message.mediaType) ? "audio" : ""}`} key={message.id}>
                  <span>{messageLabel(message)}</span>
                  <p>{message.body || "Mensagem sem texto"}</p>
                  <time>{formatChatTime(message.createdAt)}</time>
                </article>
              ))}
              {!messages.length ? <p className="empty-state">Sem mensagens registradas para este lead.</p> : null}
            </div>

            <form className="wa-composer composer" onSubmit={onSubmitMessage}>
              <button type="button" title="Emoji"><Smile size={20} /></button>
              <button type="button" title="Anexar"><Paperclip size={20} /></button>
              <input value={draft} onChange={(event) => onDraftChange(event.target.value)} placeholder="Digite uma mensagem" />
              <button type="button" title="Audio"><Mic size={20} /></button>
              <button className="send" type="submit" disabled={sending || !draft.trim()} title="Enviar"><Send size={18} /></button>
            </form>
          </section>
        ) : (
          <div className="wa-collapsed-chat conversation-collapsed">
            <MessageCircle size={40} />
            <strong>Conversa minimizada</strong>
            <span>O CRM continua aberto para anotacoes e pipeline.</span>
          </div>
        )}
      </div>
    </div>
  );
}

function PipelinePanel({
  clients,
  selectedId,
  onSelect,
  onMove
}: {
  clients: ClientWithPreview[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (clientId: string, status: LeadStatus) => void;
}) {
  return (
    <section className="pipeline-board">
      {statusFlow.map((status) => {
        const statusClients = clients.filter((client) => client.status === status);
        return (
          <div className="pipeline-column" key={status}>
            <div className="section-heading">
              <h2>{statusLabel[status]}</h2>
              <span>{statusClients.length}</span>
            </div>
            {statusClients.map((client) => (
              <article className={`pipeline-card ${client.id === selectedId ? "selected" : ""}`} key={client.id} onClick={() => onSelect(client.id)}>
                <strong>{client.name || "Lead WhatsApp"}</strong>
                <span>{serviceLabel[client.serviceInterest]}</span>
                <small>{client.lastMessage?.body || client.notes || client.phone}</small>
                <select value={client.status} onChange={(event) => onMove(client.id, event.target.value as LeadStatus)} onClick={(event) => event.stopPropagation()}>
                  {statusFlow.map((nextStatus) => <option key={nextStatus} value={nextStatus}>{statusLabel[nextStatus]}</option>)}
                </select>
              </article>
            ))}
          </div>
        );
      })}
    </section>
  );
}

function ServicesPanel({ clients, onFilter }: { clients: ClientWithPreview[]; onFilter: (service: ServiceInterest | "todos") => void }) {
  const cards: Array<{ service: ServiceInterest | "todos"; title: string; icon: React.ReactNode; count: number }> = [
    { service: "todos", title: "Todos", icon: <BriefcaseBusiness size={22} />, count: clients.length },
    { service: "plano_internacional", title: serviceLabel.plano_internacional, icon: <Globe2 size={22} />, count: clients.filter((client) => client.serviceInterest === "plano_internacional").length },
    { service: "plano_carreira", title: serviceLabel.plano_carreira, icon: <BriefcaseBusiness size={22} />, count: clients.filter((client) => client.serviceInterest === "plano_carreira").length },
    { service: "ambos", title: serviceLabel.ambos, icon: <CheckCircle2 size={22} />, count: clients.filter((client) => client.serviceInterest === "ambos").length }
  ];

  return (
    <section className="service-grid">
      {cards.map((card) => (
        <button type="button" className="service-card" key={card.service} onClick={() => onFilter(card.service)}>
          {card.icon}
          <span>{card.title}</span>
          <strong>{card.count}</strong>
        </button>
      ))}
    </section>
  );
}

function SellersPanel({
  sellers,
  onApprove,
  onRefresh
}: {
  sellers: SellerRecord[];
  onApprove: (seller: SellerRecord, active: boolean, role?: SellerRecord["role"]) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="seller-panel">
      <div className="section-heading">
        <h2>Aprovacao de vendedores</h2>
        <button className="icon-command" type="button" onClick={onRefresh} title="Atualizar"><RefreshCw size={18} /></button>
      </div>
      {sellers.map((seller) => (
        <article className="seller-row" key={seller.id}>
          <div>
            <strong>{seller.name}</strong>
            <span>{seller.email || "Sem email"} · {seller.role === "admin" ? "Administrador" : "Vendedor"}</span>
          </div>
          <small className={`seller-state ${seller.active ? "active" : ""}`}>{seller.active ? "Aprovado" : "Pendente"}</small>
          <select value={seller.role} onChange={(event) => onApprove(seller, seller.active, event.target.value as SellerRecord["role"])}>
            <option value="seller">Vendedor</option>
            <option value="admin">Administrador</option>
          </select>
          <button type="button" onClick={() => onApprove(seller, !seller.active)}>{seller.active ? "Bloquear" : "Aprovar"}</button>
        </article>
      ))}
      {!sellers.length ? <p className="empty-state">Nenhum vendedor cadastrado ainda.</p> : null}
    </section>
  );
}

function BotPanel({
  botStatus,
  botQr,
  qrVersion,
  onRefresh
}: {
  botStatus: BotStatus | null;
  botQr: BotQr | null;
  qrVersion: number;
  onRefresh: () => void;
}) {
  const status = botStatus?.status ?? "carregando";
  const isReady = !botStatus?.stale && (status === "ready" || status === "authenticated");
  const showQr = !botStatus?.stale && status === "waiting_qr_scan";
  const isDisconnected = !isReady && !showQr;

  return (
    <section className="bot-grid">
      <div className="bot-status-panel">
        <div className="section-heading">
          <h2>Status</h2>
          <button className="icon-command" type="button" onClick={onRefresh} title="Atualizar">
            <RefreshCw size={18} />
          </button>
        </div>
        <strong className={`bot-state ${isReady ? "ready" : ""} ${isDisconnected ? "blocked" : ""}`}>{botStatus?.stale ? "offline" : status}</strong>
        <span>{botStatus?.updatedAt ? new Date(botStatus.updatedAt).toLocaleString("pt-BR") : "Aguardando leitura do servidor"}</span>
        {botStatus?.message ? <p>{botStatus.message}</p> : null}
      </div>

      <div className="qr-panel">
        {showQr ? (
          <img src={botQr?.qrDataUrl ?? `/api/bot-qr?t=${qrVersion}`} alt="QR Code para conectar WhatsApp" />
        ) : isReady ? (
          <div className="qr-ready">
            <CheckCircle2 size={56} />
            <strong>WhatsApp conectado</strong>
          </div>
        ) : (
          <div className="qr-ready blocked">
            <CirclePause size={56} />
            <strong>WhatsApp desconectado</strong>
            <span>Inicie ou reinicie o bot para gerar um novo QR Code.</span>
            <button type="button" onClick={onRefresh}>Atualizar status</button>
          </div>
        )}
      </div>
    </section>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function pageTitle(viewMode: ViewMode) {
  if (viewMode === "pipeline") return "Pipeline comercial";
  if (viewMode === "servicos") return "Servicos vendidos";
  if (viewMode === "vendedores") return "Equipe de vendas";
  if (viewMode === "bot") return "Pareamento do bot";
  if (viewMode === "trafego") return "Central de trafego IA";
  return "Leads do WhatsApp";
}

function pageSubtitle(viewMode: ViewMode) {
  if (viewMode === "pipeline") return "Etapas da venda para plano internacional e plano de carreira.";
  if (viewMode === "servicos") return "Separacao dos leads por interesse comercial.";
  if (viewMode === "vendedores") return "Aprove ou bloqueie acessos de vendedores.";
  if (viewMode === "bot") return "Status do WhatsApp e QR Code quando precisar reconectar.";
  if (viewMode === "trafego") return "Leads, funil, remarketing, rascunhos e sinais de qualidade para Meta.";
  return "Atendimento, anotacoes, follow-up e envio pelo WhatsApp.";
}
