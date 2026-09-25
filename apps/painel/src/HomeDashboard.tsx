import { useMemo, useState } from "react";
import {
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Layers3,
  LayoutDashboard,
  MessageCircle,
  Plus,
  PhoneCall,
  RotateCcw,
  Search,
  Send,
  Settings,
  Trophy,
  Target,
  UserRound,
  UsersRound
} from "lucide-react";
import type { ClientRecord, LeadStatus, SellerRecord, ServiceInterest } from "@crm/shared";

type DashboardView = "home" | "leads" | "pipeline" | "campanhas" | "trafego" | "vendedores" | "bot" | "bot_lab";
type HomeClient = ClientRecord & { athleteAge?: number | null };

type HomeDashboardProps = {
  clients: HomeClient[];
  sellers: SellerRecord[];
  currentSeller: SellerRecord;
  isAdmin: boolean;
  loading: boolean;
  onNavigate: (view: DashboardView) => void;
  onRefresh: () => void;
  onSignOut: () => void;
};

const serviceNames: Record<ServiceInterest, string> = {
  plano_carreira: "Plano de Carreira",
  plano_internacional: "Plano Internacional",
  eurocamp: "Eurocamp",
  eurocamp_latam: "Eurocamp LATAM",
  mentoria_prime: "Mentoria Prime",
  libertacademy_florianopolis: "LibertaAcademy",
  academy_sudamerica: "Academy Sudamerica",
  ambos: "Carreira e Internacional",
  nao_definido: "A classificar"
};

const stages: Array<{
  key: string;
  title: string;
  statuses: LeadStatus[];
  tone: string;
  hint: string;
}> = [
  { key: "new", title: "Novos leads", statuses: ["novo"], tone: "blue", hint: "Novo lead" },
  { key: "contact", title: "Primeiro contato", statuses: ["triagem"], tone: "amber", hint: "Ligar novamente" },
  { key: "qualify", title: "Qualificação", statuses: ["quente"], tone: "violet", hint: "Qualificar perfil" },
  { key: "meeting", title: "Reunião agendada", statuses: ["orcamento"], tone: "sky", hint: "Reunião confirmada" },
  { key: "proposal", title: "Proposta enviada", statuses: ["aguardando_cliente"], tone: "green", hint: "Aguardando retorno" },
  { key: "closed", title: "Fechado", statuses: ["fechado"], tone: "emerald", hint: "Cliente fechado" }
];

function isArchived(client: HomeClient) {
  return Boolean(client.archivedAt) || (client.tags ?? []).includes("arquivado");
}

function isSameDay(value: string | null | undefined, date = new Date()) {
  if (!value) return false;
  const target = new Date(value);
  return target.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) === date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function displayName(client: HomeClient) {
  return client.name?.trim() || client.athleteName?.trim() || client.phone;
}

function displayAge(client: HomeClient) {
  const metadata = client.attributionMetadata ?? {};
  const raw = client.athleteAge ?? metadata.athleteAge ?? metadata.age ?? metadata.idade;
  const age = Number(raw);
  return Number.isFinite(age) && age > 0 && age < 100 ? `${age} anos` : null;
}

function relativeTime(value: string | null | undefined) {
  if (!value) return "Sem contato";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "Agora";
  if (minutes < 60) return `Há ${minutes} min`;
  if (minutes < 1440) return `Há ${Math.floor(minutes / 60)}h`;
  return `Há ${Math.floor(minutes / 1440)} dias`;
}

function formatTime(value: string | null | undefined) {
  if (!value) return "--:--";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "EC";
}

function sellerName(client: HomeClient, sellers: SellerRecord[]) {
  return sellers.find((seller) => seller.id === client.assignedSellerId)?.name || client.meetingSellerName || "Sem responsável";
}

export function HomeDashboard({ clients, sellers, currentSeller, isAdmin, loading, onNavigate, onRefresh, onSignOut }: HomeDashboardProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "team" | "funnel" | "activities" | "reports">("funnel");
  const [query, setQuery] = useState("");
  const [service, setService] = useState<ServiceInterest | "todos">("todos");
  const [sellerFilter, setSellerFilter] = useState("todos");
  const [period, setPeriod] = useState("7");
  const activeClients = useMemo(() => clients.filter((client) => !isArchived(client)), [clients]);

  const filtered = useMemo(() => {
    const after = Date.now() - Number(period) * 86400000;
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return activeClients.filter((client) => {
      if (service !== "todos" && client.serviceInterest !== service) return false;
      if (sellerFilter !== "todos" && client.assignedSellerId !== sellerFilter) return false;
      if (Number(period) > 0 && new Date(client.createdAt).getTime() < after) return false;
      if (!normalizedQuery) return true;
      return [client.name, client.athleteName, client.phone, client.notes, serviceNames[client.serviceInterest]]
        .some((value) => String(value ?? "").toLocaleLowerCase("pt-BR").includes(normalizedQuery));
    });
  }, [activeClients, period, query, sellerFilter, service]);

  const unassigned = activeClients.filter((client) => !client.assignedSellerId);
  const negotiating = activeClients.filter((client) => client.status === "quente" || client.status === "aguardando_cliente");
  const closed = activeClients.filter((client) => client.status === "fechado");
  const meetingsToday = activeClients.filter((client) => isSameDay(client.meetingStartsAt)).sort((a, b) => new Date(a.meetingStartsAt || 0).getTime() - new Date(b.meetingStartsAt || 0).getTime());
  const overdue = activeClients.filter((client) => client.nextFollowUpAt && new Date(client.nextFollowUpAt).getTime() < Date.now() && client.status !== "fechado");
  const today = new Date();
  const longDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Sao_Paulo" }).format(today).replace(" de ", " ").replace(" de ", " ");
  const team = sellers.filter((seller) => seller.active).slice(0, 5);
  const pageCopy = {
    overview: ["Operação Comercial EC10", "Visão completa dos vendedores, leads e próximos passos", "Distribuir leads"],
    team: ["Equipe comercial", "Acompanhe a carteira, as tarefas e a evolução de cada vendedor", "Gerenciar equipe"],
    funnel: ["Funil de vendas", "Acompanhe cada oportunidade e o próximo passo da negociação", "Novo lead"],
    activities: ["Atividades comerciais", "Organize contatos, reuniões e próximos passos da equipe", "Nova atividade"],
    reports: ["Relatórios comerciais", "Acompanhe resultados reais da operação comercial", "Abrir relatórios"]
  }[activeTab];

  const nav = [
    { label: "Início", icon: LayoutDashboard, action: () => onNavigate("home") },
    { label: "Leads", icon: UsersRound, action: () => onNavigate("leads") },
    { label: "Funil de vendas", icon: Layers3, active: true, action: () => onNavigate("home") },
    { label: "WhatsApp comercial", icon: MessageCircle, action: () => onNavigate("leads") },
    { label: "Retornos", icon: RotateCcw, action: () => onNavigate("pipeline") },
    { label: "Agenda", icon: CalendarDays, action: () => window.location.assign("/agendar") },
    { label: "Relatórios", icon: BarChart3, action: () => onNavigate(isAdmin ? "trafego" : "pipeline") },
    { label: "Base de conhecimento", icon: BookOpen, action: () => onNavigate("campanhas") },
    { label: "Configurações", icon: Settings, action: () => onNavigate("bot") }
  ];

  return (
    <main className="ec10-home-shell">
      <aside className="ec10-home-sidebar">
        <button className="ec10-home-logo" type="button" onClick={() => onNavigate("home")} aria-label="EC10 Intelligence">
          <strong>EC10</strong><span>INTELLIGENCE</span>
        </button>
        <nav>
          {nav.map(({ label, icon: Icon, active, action }) => (
            <button className={active ? "active" : ""} type="button" onClick={action} key={label}><Icon size={17} />{label}</button>
          ))}
        </nav>
        <button className="ec10-home-account" type="button" onClick={onSignOut} title="Clique para sair">
          <span>{initials(currentSeller.name)}</span>
          <div><strong>{currentSeller.name}</strong><small>{currentSeller.role === "admin" ? "Superadministrador" : "Vendedor"}</small></div>
        </button>
      </aside>

      <section className="ec10-home-stage">
        <header className="ec10-home-topbar">
          <label><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar atleta ou lead..." /></label>
          <div className="ec10-home-top-actions">
            <button type="button"><CalendarDays size={17} /><span>{longDate}</span></button>
            <button className="org" type="button"><Building2 size={18} /><span><small>ORGANIZAÇÃO</small><strong>Maatheus Sport</strong></span><ChevronDown size={15} /></button>
            <button className="bell" type="button" aria-label="Notificações"><Bell size={18} /><i /></button>
            <button className="profile" type="button"><b>{initials(currentSeller.name)}</b><span><strong>{currentSeller.name}</strong><small>{currentSeller.role === "admin" ? "Superadministrador" : "Vendedor"}</small></span><ChevronDown size={15} /></button>
          </div>
        </header>

        <div className="ec10-home-content">
          <div className="ec10-home-titlebar">
            <div><h1>{pageCopy[0]}</h1><p>{pageCopy[1]}</p></div>
            <button type="button" onClick={() => activeTab === "reports" ? onNavigate(isAdmin ? "trafego" : "pipeline") : activeTab === "team" ? onNavigate(isAdmin ? "vendedores" : "leads") : onNavigate("leads")}><Plus size={18} />{pageCopy[2]}</button>
          </div>

          <div className="ec10-home-tabs">
            <button className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")}>Visão geral</button>
            <button className={activeTab === "team" ? "active" : ""} onClick={() => setActiveTab("team")}>Equipe</button>
            <button className={activeTab === "funnel" ? "active" : ""} onClick={() => setActiveTab("funnel")}><Clock3 size={14} /> Funil</button>
            <button className={activeTab === "activities" ? "active" : ""} onClick={() => setActiveTab("activities")}>Atividades</button>
            <button className={activeTab === "reports" ? "active" : ""} onClick={() => setActiveTab("reports")}><CalendarDays size={14} /> Relatórios</button>
          </div>

          {activeTab === "overview" ? <>
          <section className="ec10-home-kpis">
            <button onClick={() => onNavigate("leads")} className="blue"><span><UsersRound size={22} /></span><div><small>Leads ativos</small><strong>{activeClients.length}</strong></div><ChevronRight size={18} /></button>
            <button onClick={() => onNavigate("vendedores")} className="amber"><span><UserRound size={22} /></span><div><small>Sem responsável</small><strong>{unassigned.length}</strong></div><ChevronRight size={18} /></button>
            <button onClick={() => onNavigate("pipeline")} className="violet"><span><BarChart3 size={22} /></span><div><small>Em negociação</small><strong>{negotiating.length}</strong></div><ChevronRight size={18} /></button>
            <button onClick={() => onNavigate("pipeline")} className="green"><span><Trophy size={22} /></span><div><small>Fechados</small><strong>{closed.length}</strong></div><ChevronRight size={18} /></button>
          </section>

          <section className="ec10-home-body">
            <div className="ec10-home-primary">
              <div className="ec10-home-filters">
                <label><small>Período</small><span><CalendarDays size={15} /><select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="0">Todo o período</option></select></span></label>
                <label><small>Produto</small><span><Boxes size={15} /><select value={service} onChange={(event) => setService(event.target.value as ServiceInterest | "todos")}><option value="todos">Todos os produtos</option>{Object.entries(serviceNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></span></label>
                <label><small>Vendedor</small><span><UsersRound size={15} /><select value={sellerFilter} onChange={(event) => setSellerFilter(event.target.value)}><option value="todos">Todos os vendedores</option>{team.map((seller) => <option value={seller.id} key={seller.id}>{seller.name}</option>)}</select></span></label>
                <button type="button" onClick={() => { setPeriod("7"); setService("todos"); setSellerFilter("todos"); setQuery(""); }}><RotateCcw size={15} />Limpar filtros</button>
              </div>

              <section className="ec10-team-panel">
                <header><UsersRound size={18} /><strong>Desempenho da equipe comercial</strong></header>
                <div className="ec10-team-table">
                  <div className="head"><span>Vendedor</span><span>Leads ativos</span><span>Contatos hoje</span><span>Follow-ups vencidos</span><span>Reuniões</span><span>Propostas</span><span>Conversão</span><span /></div>
                  {(team.length ? team : [currentSeller]).map((member, index) => {
                    const owned = activeClients.filter((client) => client.assignedSellerId === member.id);
                    const contacts = owned.filter((client) => isSameDay(client.lastMessageAt)).length;
                    const memberOverdue = owned.filter((client) => client.nextFollowUpAt && new Date(client.nextFollowUpAt).getTime() < Date.now() && client.status !== "fechado").length;
                    const meetings = owned.filter((client) => Boolean(client.meetingStartsAt)).length;
                    const proposals = owned.filter((client) => client.status === "aguardando_cliente" || client.status === "quente").length;
                    const won = owned.filter((client) => client.status === "fechado").length;
                    const conversion = owned.length ? Math.round((won / owned.length) * 100) : 0;
                    return <div className="row" key={member.id}>
                      <span className="seller"><i className={`avatar a${index % 4}`}>{initials(member.name)}</i><b>{member.name}<small><em />Online</small></b></span>
                      <strong>{owned.length}</strong><span>{contacts}</span><span><mark>{memberOverdue}</mark></span><span>{meetings}</span><span>{proposals}</span>
                      <span className="conversion"><b>{conversion}%</b><i><em style={{ width: `${Math.min(100, conversion)}%` }} /></i></span><button onClick={() => onNavigate("vendedores")}>•••</button>
                    </div>;
                  })}
                </div>
              </section>

              <section className="ec10-kanban">
                <header><span><Trophy size={17} /><strong>Funil de vendas</strong></span><button>Visualização: Kanban <ChevronDown size={14} /></button></header>
                <div className="ec10-kanban-grid">
                  {stages.map((stage) => {
                    const cards = filtered.filter((client) => stage.statuses.includes(client.status));
                    return <section className={`ec10-kanban-column ${stage.tone}`} key={stage.key}>
                      <header><span>{stage.title}</span><b>{cards.length}</b><Plus size={14} /></header>
                      <div>{cards.slice(0, 4).map((client) => <button type="button" onClick={() => onNavigate("leads")} className="ec10-lead-card" key={client.id}>
                        <strong>{displayName(client)}</strong><small>{[displayAge(client), serviceNames[client.serviceInterest]].filter(Boolean).join(" · ")}</small>
                        <span><i>{initials(sellerName(client, sellers))}</i>{sellerName(client, sellers)}<em><Clock3 size={11} />{client.meetingStartsAt ? formatTime(client.meetingStartsAt) : relativeTime(client.lastMessageAt || client.createdAt)}</em></span>
                        <mark>{stage.hint}</mark>
                      </button>)}</div>
                      {!cards.length ? <p>Nenhum lead nesta etapa</p> : null}
                    </section>;
                  })}
                </div>
              </section>
            </div>

            <aside className="ec10-home-rail">
              <button className="ec10-distribution-warning" type="button" onClick={() => onNavigate(isAdmin ? "vendedores" : "leads")}><CircleAlert size={24} /><span><strong>{unassigned.length} leads aguardam distribuição</strong><small>Distribua os leads para sua equipe aumentar o aproveitamento.</small></span><ChevronRight size={18} /></button>
              <section className="ec10-priorities">
                <header><span><Boxes size={17} />Prioridades de hoje</span></header>
                <div className="priority-group"><strong><Clock3 size={15} />Follow-ups vencidos ({overdue.length})</strong><button onClick={() => onNavigate("pipeline")}>Ver todos</button></div>
                {overdue.slice(0, 3).map((client) => <button className="priority-item danger" type="button" onClick={() => onNavigate("leads")} key={client.id}><Clock3 size={16} /><span><strong>{displayName(client)}{displayAge(client) ? `, ${displayAge(client)}` : ""}</strong><small>{serviceNames[client.serviceInterest]} · Vencido</small></span><ChevronRight size={15} /></button>)}
                <div className="priority-group amber"><strong><UserRound size={15} />Leads sem responsável ({unassigned.length})</strong><button onClick={() => onNavigate("vendedores")}>Ver todos</button></div>
                {unassigned.slice(0, 3).map((client) => <button className="priority-item" type="button" onClick={() => onNavigate("leads")} key={client.id}><Clock3 size={16} /><span><strong>{displayName(client)}{displayAge(client) ? `, ${displayAge(client)}` : ""}</strong><small>{serviceNames[client.serviceInterest]} · Novo lead</small></span><ChevronRight size={15} /></button>)}
                <div className="priority-group blue"><strong><CalendarDays size={15} />Reuniões de hoje ({meetingsToday.length})</strong><button onClick={() => window.location.assign("/agendar")}>Ver todos</button></div>
                {meetingsToday.slice(0, 4).map((client) => <button className="meeting-item" type="button" onClick={() => onNavigate("leads")} key={client.id}><b>{formatTime(client.meetingStartsAt)}</b><span><strong>{displayName(client)}{displayAge(client) ? `, ${displayAge(client)}` : ""}</strong><small>{serviceNames[client.serviceInterest]} · {sellerName(client, sellers)}</small></span><ChevronRight size={15} /></button>)}
                {!overdue.length && !unassigned.length && !meetingsToday.length ? <p className="ec10-home-empty">Nenhuma prioridade pendente hoje.</p> : null}
              </section>
            </aside>
          </section>
          </> : null}
          {activeTab === "funnel" ? <FunnelView clients={filtered} allClients={activeClients} sellers={sellers} unassigned={unassigned} negotiating={negotiating} closed={closed} service={service} sellerFilter={sellerFilter} query={query} onService={setService} onSeller={setSellerFilter} onQuery={setQuery} onNavigate={onNavigate} /> : null}
          {activeTab === "team" ? <TeamView clients={activeClients} sellers={team.length ? team : [currentSeller]} unassigned={unassigned} overdue={overdue} service={service} sellerFilter={sellerFilter} period={period} onService={setService} onSeller={setSellerFilter} onPeriod={setPeriod} onNavigate={onNavigate} /> : null}
          {activeTab === "activities" ? <ActivitiesView clients={activeClients} sellers={sellers} overdue={overdue} meetingsToday={meetingsToday} onNavigate={onNavigate} /> : null}
          {activeTab === "reports" ? <ReportsView clients={activeClients} sellers={sellers} onNavigate={onNavigate} /> : null}
          {loading ? <div className="ec10-home-loading">Atualizando os dados reais do CRM…</div> : null}
          <button className="ec10-home-refresh" type="button" onClick={onRefresh} aria-label="Atualizar painel"><RotateCcw size={16} /></button>
        </div>
      </section>
    </main>
  );
}

function FunnelView({ clients, allClients, sellers, unassigned, negotiating, closed, service, sellerFilter, query, onService, onSeller, onQuery, onNavigate }: {
  clients: HomeClient[]; allClients: HomeClient[]; sellers: SellerRecord[]; unassigned: HomeClient[]; negotiating: HomeClient[]; closed: HomeClient[];
  service: ServiceInterest | "todos"; sellerFilter: string; query: string;
  onService: (value: ServiceInterest | "todos") => void; onSeller: (value: string) => void; onQuery: (value: string) => void; onNavigate: (view: DashboardView) => void;
}) {
  return <section className="ec10-funnel-screen">
    <div className="ec10-screen-kpis funnel">
      <Kpi icon={<UsersRound size={22} />} label="Leads ativos" value={allClients.length} tone="blue" />
      <Kpi icon={<UserRound size={22} />} label="Sem responsável" value={unassigned.length} tone="amber" />
      <Kpi icon={<BarChart3 size={22} />} label="Em negociação" value={negotiating.length} tone="violet" />
      <Kpi icon={<Trophy size={22} />} label="Fechados" value={closed.length} tone="green" />
      <button className="ec10-inline-warning" type="button" onClick={() => onNavigate("vendedores")}><CircleAlert size={24} /><span><strong>{unassigned.length} leads aguardam distribuição</strong><small>Distribua os leads para sua equipe aumentar o aproveitamento.</small></span><b>Distribuir</b></button>
    </div>
    <div className="ec10-funnel-controls">
      <label><Boxes size={16} /><select value={service} onChange={(event) => onService(event.target.value as ServiceInterest | "todos")}><option value="todos">Todos os produtos</option>{Object.entries(serviceNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><ChevronDown size={14} /></label>
      <label><UsersRound size={16} /><select value={sellerFilter} onChange={(event) => onSeller(event.target.value)}><option value="todos">Todos os vendedores</option>{sellers.filter((seller) => seller.active).map((seller) => <option value={seller.id} key={seller.id}>{seller.name}</option>)}</select><ChevronDown size={14} /></label>
      <button><Target size={16} />Origem<ChevronDown size={14} /></button><button><Layers3 size={16} />Prioridade<ChevronDown size={14} /></button>
      <label className="search"><Search size={16} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Buscar leads..." /></label>
      <div className="view-toggle"><button className="active">Kanban</button><button>Lista</button></div><button className="automation"><Settings size={16} />Automação</button>
    </div>
    <section className="ec10-pipeline-screen">
      <header><span><CalendarDays size={18} /><strong>Pipeline de vendas</strong><small>Dados em tempo real</small></span></header>
      <div className="ec10-pipeline-grid">
        {stages.map((stage) => {
          const cards = clients.filter((client) => stage.statuses.includes(client.status));
          return <section className={`ec10-pipeline-column ${stage.tone}`} key={stage.key}>
            <header><span>{stage.title}</span><b>{cards.length}</b><Plus size={16} /></header>
            <div>{cards.slice(0, 5).map((client) => <button type="button" className="ec10-pipeline-card" key={client.id} onClick={() => onNavigate("leads")}>
              <div><strong>{displayName(client)}</strong><b>•••</b></div><small>{[displayAge(client), serviceNames[client.serviceInterest]].filter(Boolean).join(" · ")}</small>
              {stage.key === "new" ? <span className="origin"><Target size={13} />Origem: {client.utmSource || client.trafficSource || "WhatsApp"}</span> : <span className="owner"><i>{initials(sellerName(client, sellers))}</i>{sellerName(client, sellers)}<em><CalendarDays size={12} />{client.meetingStartsAt ? formatTime(client.meetingStartsAt) : relativeTime(client.lastMessageAt || client.createdAt)}</em></span>}
              <mark>{stage.key === "new" && !client.assignedSellerId ? "Sem responsável" : stage.hint}</mark>
              {stage.key === "new" && !client.assignedSellerId ? <span className="assign"><UserRound size={13} />Atribuir</span> : null}
            </button>)}</div>
            {!cards.length ? <div className="pipeline-empty"><Trophy size={42} /><strong>Nenhuma venda registrada</strong><small>Quando um lead for fechado, ele aparecerá aqui.</small></div> : null}
          </section>;
        })}
      </div>
    </section>
  </section>;
}

function TeamView({ clients, sellers, unassigned, overdue, service, sellerFilter, period, onService, onSeller, onPeriod, onNavigate }: {
  clients: HomeClient[]; sellers: SellerRecord[]; unassigned: HomeClient[]; overdue: HomeClient[]; service: ServiceInterest | "todos"; sellerFilter: string; period: string;
  onService: (value: ServiceInterest | "todos") => void; onSeller: (value: string) => void; onPeriod: (value: string) => void; onNavigate: (view: DashboardView) => void;
}) {
  const distributed = clients.filter((client) => client.assignedSellerId).length;
  return <section className="ec10-team-screen">
    <div className="ec10-screen-kpis team"><Kpi icon={<UsersRound size={22} />} label="Vendedores ativos" value={sellers.length} tone="blue" /><Kpi icon={<Layers3 size={22} />} label="Leads distribuídos" value={distributed} tone="violet" /><Kpi icon={<UserRound size={22} />} label="Sem responsável" value={unassigned.length} tone="amber" /><Kpi icon={<Clock3 size={22} />} label="Follow-ups vencidos" value={overdue.length} tone="red" /></div>
    <section className="ec10-team-screen-body"><div className="ec10-team-main">
      <div className="ec10-home-filters"><label><small>Período</small><span><CalendarDays size={15} /><select value={period} onChange={(event) => onPeriod(event.target.value)}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="0">Todo o período</option></select></span></label><label><small>Produto</small><span><Boxes size={15} /><select value={service} onChange={(event) => onService(event.target.value as ServiceInterest | "todos")}><option value="todos">Todos os produtos</option>{Object.entries(serviceNames).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></span></label><label><small>Vendedor</small><span><UsersRound size={15} /><select value={sellerFilter} onChange={(event)=>onSeller(event.target.value)}><option value="todos">Todos os vendedores</option>{sellers.map((seller)=><option value={seller.id} key={seller.id}>{seller.name}</option>)}</select></span></label><button><RotateCcw size={15} />Limpar filtros</button></div>
      <section className="ec10-seller-cards"><header><UsersRound size={18} /><strong>Vendedores da equipe</strong></header><div>{sellers.slice(0,3).map((seller,index)=>{
        const owned=clients.filter((client)=>client.assignedSellerId===seller.id); const contacts=owned.filter((client)=>isSameDay(client.lastMessageAt)).length; const followups=owned.filter((client)=>client.nextFollowUpAt&&new Date(client.nextFollowUpAt).getTime()<Date.now()&&client.status!=="fechado").length; const meetings=owned.filter((client)=>client.meetingStartsAt).length; const proposals=owned.filter((client)=>client.status==="quente"||client.status==="aguardando_cliente").length; const won=owned.filter((client)=>client.status==="fechado").length; const workload=Math.min(100,Math.round((owned.length/Math.max(1,Math.max(...sellers.map((s)=>clients.filter((c)=>c.assignedSellerId===s.id).length))))*100));
        return <article key={seller.id}><div className="seller-card-head"><i className={`avatar a${index}`}>{initials(seller.name)}</i><span><strong>{seller.name}</strong><small><em />Online</small></span><button onClick={()=>onNavigate("vendedores")}>Abrir carteira</button></div><div className="seller-card-metrics"><span>Leads atribuídos<strong>{owned.length}</strong></span><span>Contatos hoje<strong>{contacts}</strong></span><span>Follow-ups hoje<mark>{followups}</mark></span><span>Reuniões<strong>{meetings}</strong></span><span>Propostas<strong>{proposals}</strong></span><span>Vendas<strong>{won}</strong></span></div><div className="workload"><small>Carga de trabalho</small><i><em style={{width:`${workload}%`}} /></i><b>{workload}%</b></div></article>})}</div></section>
      <section className="ec10-team-comparison"><header><BarChart3 size={18}/><strong>Comparativo da equipe</strong></header><div className="comparison-head"><span>Vendedor</span><span>Carteira</span><span>Primeira resposta</span><span>Contatos no prazo</span><span>Follow-ups vencidos</span><span>Reuniões</span><span>Propostas</span><span>Vendas</span></div>{sellers.slice(0,4).map((seller,index)=>{const owned=clients.filter((client)=>client.assignedSellerId===seller.id);const late=owned.filter((client)=>client.nextFollowUpAt&&new Date(client.nextFollowUpAt).getTime()<Date.now()).length;return <div className="comparison-row" key={seller.id}><span><i className={`avatar a${index}`}>{initials(seller.name)}</i>{seller.name}</span><b>{owned.length}</b><span>—</span><span>{Math.max(0,100-Math.round(late/Math.max(1,owned.length)*100))}%</span><mark>{late}</mark><span>{owned.filter((c)=>c.meetingStartsAt).length}</span><span>{owned.filter((c)=>c.status==="quente"||c.status==="aguardando_cliente").length}</span><span>{owned.filter((c)=>c.status==="fechado").length}</span></div>})}</section>
      <section className="ec10-recent-activity"><header><Clock3 size={18}/><strong>Atividade recente</strong><button onClick={()=>onNavigate("pipeline")}>Ver todas</button></header>{clients.filter((client)=>client.lastMessageAt).sort((a,b)=>new Date(b.lastMessageAt||0).getTime()-new Date(a.lastMessageAt||0).getTime()).slice(0,4).map((client)=><div key={client.id}><b>{formatTime(client.lastMessageAt)}</b><span>{sellerName(client,sellers)}</span><mark>Contato realizado</mark><span>{displayName(client)}</span><small>{serviceNames[client.serviceInterest]}</small></div>)}</section>
    </div><aside className="ec10-team-rail"><section><header><Settings size={18}/><strong>Gestão da equipe</strong></header><button className="ec10-distribution-warning" onClick={()=>onNavigate("vendedores")}><CircleAlert size={24}/><span><strong>{unassigned.length} leads sem responsável</strong><small>Distribua os leads para sua equipe aumentar o aproveitamento.</small></span><ChevronRight size={16}/></button><div className="load-balance"><BarChart3 size={20}/><span><strong>Equilíbrio de carga da equipe</strong><small>Distribuição atual da carteira</small><i><em style={{width:`${Math.min(100,distributed/Math.max(1,clients.length)*100)}%`}}/></i></span></div><button className="primary-wide" onClick={()=>onNavigate("vendedores")}><Layers3 size={16}/>Distribuir leads</button></section><section><header><CheckCircle2 size={18}/><strong>Ações do gestor</strong></header><button className="manager-action"><Clock3 size={18}/><span><strong>Auditar follow-ups vencidos ({overdue.length})</strong><small>Revise os leads com follow-ups em atraso.</small></span><ChevronRight size={15}/></button><button className="manager-action"><Send size={18}/><span><strong>Revisar leads parados</strong><small>Identifique leads sem atividade recente.</small></span><ChevronRight size={15}/></button></section><section><header><Target size={18}/><strong>Metas da semana</strong></header><div className="weekly-goals"><Goal label="Reuniões marcadas" value={clients.filter((c)=>c.meetingStartsAt).length} target={15} tone="blue"/><Goal label="Propostas enviadas" value={clients.filter((c)=>c.status==="quente"||c.status==="aguardando_cliente").length} target={10} tone="green"/><Goal label="Vendas fechadas" value={clients.filter((c)=>c.status==="fechado").length} target={5} tone="violet"/></div></section></aside></section>
  </section>;
}

function ActivitiesView({ clients, sellers, overdue, meetingsToday, onNavigate }: { clients: HomeClient[]; sellers: SellerRecord[]; overdue: HomeClient[]; meetingsToday: HomeClient[]; onNavigate: (view: DashboardView) => void }) {
  const today=clients.filter((client)=>isSameDay(client.nextFollowUpAt)||isSameDay(client.meetingStartsAt));
  const upcoming=clients.filter((client)=>{const value=client.nextFollowUpAt||client.meetingStartsAt;if(!value)return false;const time=new Date(value).getTime();return time>Date.now()&&!isSameDay(value)});
  const completed=clients.filter((client)=>client.status==="fechado");
  const groups=[{label:"Atrasadas",tone:"danger",items:overdue},{label:"Hoje",tone:"today",items:today},{label:"Próximos dias",tone:"next",items:upcoming},{label:"Concluídas",tone:"done",items:completed}];
  return <section className="ec10-activities-screen"><div className="ec10-screen-kpis team"><Kpi icon={<CalendarDays size={22}/>} label="Para hoje" value={today.length} tone="blue"/><Kpi icon={<CircleAlert size={22}/>} label="Atrasadas" value={overdue.length} tone="red"/><Kpi icon={<CheckCircle2 size={22}/>} label="Concluídas" value={completed.length} tone="green"/><Kpi icon={<UsersRound size={22}/>} label="Reuniões" value={meetingsToday.length} tone="violet"/></div><section className="ec10-activities-body"><div className="ec10-activities-main"><div className="activity-controls"><div><button className="active">Todas</button><button>Hoje</button><button>Atrasadas</button><button>Próximas</button><button>Concluídas</button></div><button>Vendedor<ChevronDown size={14}/></button><button>Tipo<ChevronDown size={14}/></button><button>Produto<ChevronDown size={14}/></button><button>Período<ChevronDown size={14}/></button><label><Search size={15}/><input placeholder="Buscar atividades..."/></label></div><section className="activity-table"><header><span>Tipo</span><span>Ação</span><span>Lead / Atleta</span><span>Produto</span><span>Vendedor</span><span>Data e hora</span><span>Status</span><span>Ações</span></header>{groups.map((group)=><div className={`activity-group ${group.tone}`} key={group.label}><div className="activity-group-title"><ChevronDown size={14}/><strong>{group.label}</strong><b>{group.items.length}</b></div>{group.items.slice(0,4).map((client)=><button key={`${group.label}-${client.id}`} type="button" onClick={()=>onNavigate("leads")}><span className="activity-type">{client.meetingStartsAt?<UsersRound size={14}/>:<MessageCircle size={14}/>} {client.meetingStartsAt?"Reunião":"WhatsApp"}</span><span>{client.meetingStartsAt?"Reunião online":"Retornar contato"}</span><strong>{displayName(client)}</strong><span>{serviceNames[client.serviceInterest]}</span><span className="activity-owner"><i>{initials(sellerName(client,sellers))}</i>{sellerName(client,sellers)}</span><span>{new Intl.DateTimeFormat("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"America/Sao_Paulo"}).format(new Date(client.meetingStartsAt||client.nextFollowUpAt||client.lastMessageAt||client.createdAt))}</span><mark>{group.label}</mark><b>•••</b></button>)}</div>)}</section></div><aside className="ec10-activity-rail"><section><header><CalendarDays size={18}/><strong>Agenda de hoje</strong><button onClick={()=>window.location.assign("/agendar")}>Ver agenda completa →</button></header>{meetingsToday.slice(0,6).map((client,index)=><button key={client.id} onClick={()=>onNavigate("leads")}><b>{formatTime(client.meetingStartsAt)}</b><i className={`dot d${index%3}`}/><span><mark>Reunião</mark><strong>{displayName(client)}</strong><small>{serviceNames[client.serviceInterest]}</small></span><em>{sellerName(client,sellers)}</em></button>)}</section><section><header><CircleAlert size={18}/><strong>Prioridades do gestor</strong></header><button className="manager-action"><Clock3 size={18}/><span><strong>{overdue.length} follow-ups atrasados</strong><small>Leads sem retorno dentro do prazo</small></span><ChevronRight size={15}/></button><button className="manager-action"><UserRound size={18}/><span><strong>{clients.filter((c)=>!c.assignedSellerId).length} atividades sem responsável</strong><small>Defina um vendedor para continuar</small></span><ChevronRight size={15}/></button><button className="manager-action"><CalendarDays size={18}/><span><strong>Reatribuição rápida</strong><small>Redistribua atividades da equipe</small></span><b onClick={()=>onNavigate("vendedores")}>Reatribuir</b></button></section></aside></section></section>;
}

function ReportsView({ clients, sellers, onNavigate }: { clients: HomeClient[]; sellers: SellerRecord[]; onNavigate: (view: DashboardView) => void }) {
  const meetings=clients.filter((client)=>client.meetingStartsAt).length;const closed=clients.filter((client)=>client.status==="fechado").length;const conversion=clients.length?Math.round(closed/clients.length*100):0;
  return <section className="ec10-reports-screen"><div className="ec10-screen-kpis team"><Kpi icon={<UsersRound size={22}/>} label="Leads analisados" value={clients.length} tone="blue"/><Kpi icon={<CalendarDays size={22}/>} label="Reuniões" value={meetings} tone="violet"/><Kpi icon={<Trophy size={22}/>} label="Vendas" value={closed} tone="green"/><Kpi icon={<Target size={22}/>} label="Conversão" value={`${conversion}%`} tone="amber"/></div><section><BarChart3 size={46}/><h2>Relatórios comerciais consolidados</h2><p>Os números exibidos vêm dos leads, reuniões e vendedores cadastrados no CRM.</p><div>{sellers.filter((seller)=>seller.active).map((seller)=><span key={seller.id}><strong>{seller.name}</strong><small>{clients.filter((client)=>client.assignedSellerId===seller.id).length} leads na carteira</small></span>)}</div><button onClick={()=>onNavigate("trafego")}>Abrir central completa de relatórios</button></section></section>;
}

function Kpi({icon,label,value,tone}:{icon:React.ReactNode;label:string;value:string|number;tone:string}){return <button className={`ec10-screen-kpi ${tone}`} type="button"><i>{icon}</i><span><small>{label}</small><strong>{value}</strong></span><ChevronRight size={17}/></button>}
function Goal({label,value,target,tone}:{label:string;value:number;target:number;tone:string}){const percent=Math.min(100,Math.round(value/Math.max(1,target)*100));return <div className={`goal ${tone}`}><span><strong>{label}</strong><b>{value} / {target}</b></span><i><em style={{width:`${percent}%`}}/></i></div>}
