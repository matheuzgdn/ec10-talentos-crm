import { type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CirclePause,
  Columns3,
  Eye,
  EyeOff,
  FileText,
  Filter,
  FlaskConical,
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
  Trash2,
  TrendingUp,
  Trophy,
  UserCheck,
  UsersRound,
  Video
} from "lucide-react";
import type { CampaignKey, ChatMessage, ClientRecord, LeadStatus, SellerRecord, ServiceInterest } from "@crm/shared";
import { CareerPlanSignupPage } from "./CareerPlanSignupPage";
import { BookingPage } from "./BookingPage";
import { BotLabPanel } from "./BotLabPanel";
import { TrafficPanel } from "./TrafficPanel";
import { BhPrimeManager } from "./BhPrimeManager";

type ViewMode = "leads" | "campanhas" | "formularios" | "libertacademy" | "pipeline" | "servicos" | "vendedores" | "bot" | "bot_lab" | "trafego" | "bh_prime";
type AuthMode = "login" | "signup";
type LeadFolder = "ec10" | "revela" | "todos";
type LeadBucket = "ativos" | "sem_agenda" | "agendados" | "arquivados" | "todos";
type LeadOriginFilter = "todas" | "site_a" | "site_b" | "instagram";
type FormPageFilter = "todas" | "site_a" | "site_b";
type ClientPatch = Partial<ClientRecord> & {
  botPaused?: boolean;
  athleteName?: string | null;
  athleteVideoUrls?: string[];
  archiveClient?: boolean;
  confirmAdhesion?: boolean;
};

type BotStatus = {
  status: string;
  botInstanceId?: string;
  botInstanceLabel?: string;
  updatedAt?: string;
  qrPath?: string;
  message?: string;
  stale?: boolean;
  source?: string;
};

type BotQr = {
  qrDataUrl?: string;
  updatedAt?: string;
};

type BotInstanceInfo = {
  id: "main" | "mentoria_prime";
  label: string;
};

type ClientWithPreview = ClientRecord & {
  lastMessage?: {
    body: string | null;
    direction: "inbound" | "outbound";
    mediaType: string;
    createdAt: string;
  } | null;
};

type FormSubmission = {
  id: string;
  name: string | null;
  phone: string;
  status: LeadStatus;
  serviceInterest: ServiceInterest;
  assignedSellerId: string | null;
  sellerName: string | null;
  tags: string[];
  leadScore: number;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  pageVariant: "site_a" | "site_b";
  campaignName: string | null;
  landingUrl: string | null;
  sourcePath: string | null;
  formVariant: string | null;
  roleAnswer: string | null;
  athleteName: string | null;
  investmentRange: string | null;
  videoMaterialStatus: string | null;
  financialQualified: string | null;
  commercialPriority: string | null;
  botStage: string | null;
  athleteAge: number | null;
  ageGroup: string | null;
  meetingStartsAt: string | null;
  meetingSellerName: string | null;
  whatsappSent: number;
  whatsappQueued: number;
  whatsappFailed: number;
  whatsappCancelled: number;
  lastSentAt: string | null;
  lastError: string | null;
  confirmedMessages: number;
  unconfirmedMessages: number;
};

type LibertacademySubmission = {
  id: string;
  name: string | null;
  phone: string;
  status: LeadStatus;
  assignedSellerId: string | null;
  sellerName: string | null;
  leadScore: number;
  createdAt: string;
  updatedAt: string;
  academy: string | null;
  country: string | null;
  contactRole: string | null;
  decisionMakerConfirmed: boolean;
  categories: string[];
  athleteCount: number | null;
  language: "pt" | "es";
  routedWhatsapp: string | null;
  routingStrategy: string | null;
  metaEventId: string | null;
  metaLeadAccepted: boolean;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  whatsappSent: number;
  whatsappQueued: number;
  whatsappFailed: number;
  confirmedMessages: number;
  meetingStartsAt: string | null;
};

const statusLabel: Record<LeadStatus, string> = {
  novo: "Novo contato",
  triagem: "Atendimento",
  orcamento: "Reuniao agendada",
  aguardando_cliente: "Pos-reuniao",
  quente: "Negociacao",
  fechado: "Cliente fechado",
  perdido: "Sem avanco"
};

const statusDescription: Record<LeadStatus, string> = {
  novo: "Lead novo para primeiro contato.",
  triagem: "Qualificar idade, perfil e interesse.",
  orcamento: "Meet ou reagendamento confirmado.",
  aguardando_cliente: "Retorno depois da apresentacao.",
  quente: "Contrato, pagamento ou decisao ativa.",
  fechado: "Adesao confirmada e sinal enviada ao Meta.",
  perdido: "Nao compareceu, recusou ou ficou sem resposta."
};

const statusFlow: LeadStatus[] = ["novo", "triagem", "orcamento", "aguardando_cliente", "quente", "fechado", "perdido"];

const serviceLabel: Record<ServiceInterest, string> = {
  plano_internacional: "Plano internacional",
  plano_carreira: "Plano de carreira",
  ambos: "Ambos",
  nao_definido: "Nao definido",
  eurocamp: "Eurocamp",
  eurocamp_latam: "Eurocamp LATAM",
  mentoria_prime: "Mentoria Prime",
  libertacademy_florianopolis: "LibertaAcademy Florianopolis",
  academy_sudamerica: "Academy Sudamerica"
};

const serviceOptions = Object.keys(serviceLabel) as ServiceInterest[];

type CampaignFilter = CampaignKey | "todos";

const campaignOrder: CampaignKey[] = [
  "plano_carreira",
  "plano_internacional",
  "eurocamp",
  "libertacademy",
  "mentoria_prime",
  "academy_sudamerica",
  "outros"
];

const campaignDefinition: Record<CampaignKey, { title: string; shortTitle: string; audience: string; objective: string }> = {
  plano_carreira: {
    title: "Plano de Carreira",
    shortTitle: "Carreira",
    audience: "Responsáveis e atletas buscando desenvolvimento, acompanhamento e oportunidades.",
    objective: "Qualificar perfil, agendar apresentação e conduzir a família até a adesão."
  },
  plano_internacional: {
    title: "Plano Internacional",
    shortTitle: "Internacional",
    audience: "Atletas e responsáveis com interesse e capacidade para oportunidades internacionais.",
    objective: "Validar perfil, investimento e disponibilidade antes da proposta internacional."
  },
  eurocamp: {
    title: "EC10 Eurocamp",
    shortTitle: "Eurocamp",
    audience: "Responsáveis por atletas com interesse real em experiência e avaliação internacional.",
    objective: "Confirmar decisor, capacidade financeira e janela de participação."
  },
  libertacademy: {
    title: "Libertacademy",
    shortTitle: "Libertacademy",
    audience: "Donos, gestores e responsáveis por escolas e projetos de futebol.",
    objective: "Validar a organização, volume de atletas e interesse na participação do torneio."
  },
  mentoria_prime: {
    title: "Mentoria Prime",
    shortTitle: "Mentoria",
    audience: "Atletas e responsáveis interessados em orientação estratégica individual.",
    objective: "Entender o momento do atleta, apresentar a mentoria e conduzir para a adesão."
  },
  academy_sudamerica: {
    title: "Academy Sudamerica",
    shortTitle: "Sudamerica",
    audience: "Gestores de escolas e projetos de futebol do Brasil e América Latina.",
    objective: "Transformar intenção do anúncio em conversa, reunião e parceria comercial."
  },
  outros: {
    title: "Origem a classificar",
    shortTitle: "A classificar",
    audience: "Leads de tráfego sem identificação comercial suficiente.",
    objective: "Revisar origem e direcionar cada contato ao serviço correto."
  }
};

const campaignStageCopy: Record<CampaignKey, Record<LeadStatus, { label: string; description: string }>> = {
  plano_carreira: buildCampaignStages(["Novo lead", "Qualificação familiar", "Reunião agendada", "Pós-reunião", "Negociação", "Adesão confirmada", "Sem avanço"]),
  plano_internacional: buildCampaignStages(["Novo lead", "Perfil internacional", "Avaliação agendada", "Proposta enviada", "Documentação e negociação", "Contratação", "Não elegível"]),
  eurocamp: buildCampaignStages(["Inscrição recebida", "Decisor e investimento", "Conversa agendada", "Acompanhamento", "Reserva e pagamento", "Participação confirmada", "Não apto agora"]),
  libertacademy: buildCampaignStages(["Escola inscrita", "Gestor validado", "Contato iniciado", "Proposta do evento", "Negociação da equipe", "Inscrição confirmada", "Sem avanço"]),
  mentoria_prime: buildCampaignStages(["Novo interessado", "Perfil capturado", "Reunião agendada", "Pós-reunião", "Adesão em decisão", "Mentorado ativo", "Sem avanço"]),
  academy_sudamerica: buildCampaignStages(["Intenção recebida", "Gestor validado", "WhatsApp iniciado", "Reunião agendada", "Negociação da parceria", "Parceria confirmada", "Sem avanço"]),
  outros: buildCampaignStages(["Novo", "Classificar serviço", "Agenda", "Acompanhamento", "Negociação", "Convertido", "Descartado"])
};

const botInstances: BotInstanceInfo[] = [
  { id: "main", label: "WhatsApp principal" },
  { id: "mentoria_prime", label: "Mentoria Prime" }
];

const leadFolderLabel: Record<LeadFolder, string> = {
  ec10: "Pasta EC10",
  revela: "Pasta Revela Talentos",
  todos: "Todas as pastas"
};

const leadBucketLabel: Record<LeadBucket, string> = {
  ativos: "Todos",
  sem_agenda: "Sem reuniao",
  agendados: "Agendados",
  arquivados: "Arquivados",
  todos: "Todos"
};

const leadOriginLabel: Record<LeadOriginFilter, string> = {
  todas: "Todas",
  site_a: "Site A - Instagram",
  site_b: "Site B - Completa",
  instagram: "Instagram"
};

const workStartDate = "2026-06-20";
const leadSidebarWidthStorageKey = "crm:leads:sidebar-width:v1";

function buildCampaignStages(labels: [string, string, string, string, string, string, string]) {
  const descriptions: Record<LeadStatus, string> = {
    novo: "Entrada identificada nesta campanha.",
    triagem: "Critérios e perfil comercial em validação.",
    orcamento: "Próximo compromisso comercial definido.",
    aguardando_cliente: "Acompanhamento depois da apresentação.",
    quente: "Decisão, proposta ou pagamento em andamento.",
    fechado: "Conversão confirmada e registrada.",
    perdido: "Sem avanço nesta oportunidade."
  };
  return Object.fromEntries(statusFlow.map((status, index) => [status, {
    label: labels[index],
    description: descriptions[status]
  }])) as Record<LeadStatus, { label: string; description: string }>;
}

function campaignIcon(campaign: CampaignKey) {
  if (campaign === "plano_internacional") return <Globe2 size={18} />;
  if (campaign === "libertacademy") return <Trophy size={18} />;
  if (campaign === "eurocamp") return <PlaneIcon />;
  if (campaign === "mentoria_prime") return <Headphones size={18} />;
  if (campaign === "academy_sudamerica") return <UsersRound size={18} />;
  if (campaign === "outros") return <Filter size={18} />;
  return <BriefcaseBusiness size={18} />;
}

function PlaneIcon() {
  return <Globe2 size={18} />;
}

function resolveCampaignKey(client: ClientRecord): CampaignKey {
  if (client.campaignKey && campaignOrder.includes(client.campaignKey)) return client.campaignKey;
  const tags = (client.tags ?? []).map((tag) => tag.toLowerCase());
  const metadata = client.attributionMetadata ?? {};
  const sourceText = [
    client.trafficCampaignName,
    client.utmCampaign,
    metadata.formType,
    metadata.formVariant,
    metadata.campaignProject,
    metadata.campaign_project
  ].map((value) => String(value ?? "").toLowerCase()).join(" ");

  if (tags.some((tag) => tag.includes("libertacademy")) || sourceText.includes("libertacademy")) return "libertacademy";
  if (tags.some((tag) => tag.includes("sudamerica")) || sourceText.includes("sudamerica")) return "academy_sudamerica";
  if (tags.some((tag) => tag.includes("eurocamp")) || sourceText.includes("eurocamp")) return "eurocamp";
  if (tags.some((tag) => tag.includes("mentoria_prime")) || sourceText.includes("mentoria_prime")) return "mentoria_prime";
  if (client.serviceInterest === "plano_internacional") return "plano_internacional";
  if (client.serviceInterest === "plano_carreira") return "plano_carreira";
  return "outros";
}

export function App() {
  const publicPath = window.location.pathname.replace(/\/+$/, "") || "/";
  if (publicPath === "/agendar") return <BookingPage />;
  if (["/cadastro-plano-carreira", "/plano-carreira-cadastro", "/inscricao-plano-carreira"].includes(publicPath)) {
    return <CareerPlanSignupPage />;
  }

  const [session, setSession] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [seller, setSeller] = useState<SellerRecord | null>(null);
  const [sellers, setSellers] = useState<SellerRecord[]>([]);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>(publicPath === "/gerenciador-bh-prime" ? "bh_prime" : "leads");
  const [clients, setClients] = useState<ClientWithPreview[]>([]);
  const [campaignClients, setCampaignClients] = useState<ClientWithPreview[]>([]);
  const [activeCampaign, setActiveCampaign] = useState<CampaignFilter>("plano_carreira");
  const [selectedCampaignClientId, setSelectedCampaignClientId] = useState<string | null>(null);
  const [formSubmissions, setFormSubmissions] = useState<FormSubmission[]>([]);
  const [libertacademySubmissions, setLibertacademySubmissions] = useState<LibertacademySubmission[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [formSearch, setFormSearch] = useState("");
  const [formPageFilter, setFormPageFilter] = useState<FormPageFilter>("todas");
  const [libertacademySearch, setLibertacademySearch] = useState("");
  const [libertacademyDestination, setLibertacademyDestination] = useState("todos");
  const [leadFolder, setLeadFolder] = useState<LeadFolder>("ec10");
  const [leadBucket, setLeadBucket] = useState<LeadBucket>("ativos");
  const [leadOrigin, setLeadOrigin] = useState<LeadOriginFilter>("todas");
  const [sellerFilter, setSellerFilter] = useState("todos");
  const [serviceFilter, setServiceFilter] = useState<ServiceInterest | "todos">("todos");
  const [draft, setDraft] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [newClientService, setNewClientService] = useState<ServiceInterest>("plano_internacional");
  const [loadingClients, setLoadingClients] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingForms, setLoadingForms] = useState(false);
  const [loadingLibertacademy, setLoadingLibertacademy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [botStatuses, setBotStatuses] = useState<Record<string, BotStatus>>({});
  const [qrVersion, setQrVersion] = useState(Date.now());
  const [minimizedLeadIds, setMinimizedLeadIds] = useState<Set<string>>(new Set());
  const [conversationMinimized, setConversationMinimized] = useState(false);
  const [leadCrmDrawerVisible, setLeadCrmDrawerVisible] = useState(false);
  const [leadToolsVisible, setLeadToolsVisible] = useState(true);
  const [leadSidebarWidth, setLeadSidebarWidth] = useState(() => {
    const storedWidth = Number(window.localStorage.getItem(leadSidebarWidthStorageKey));
    return Number.isFinite(storedWidth) ? Math.min(560, Math.max(300, storedWidth)) : 360;
  });
  const [manualLeadOpen, setManualLeadOpen] = useState(false);
  const [resettingBotIds, setResettingBotIds] = useState<Set<string>>(new Set());
  const clientsRequestRef = useRef(0);
  const campaignsRequestRef = useRef(0);
  const formsRequestRef = useRef(0);
  const libertacademyRequestRef = useRef(0);
  const messagesRequestRef = useRef(0);
  const botStatusRequestRef = useRef(0);

  const selectedClient = clients.find((client) => client.id === selectedId) ?? clients[0] ?? null;
  const selectedCampaignClient = campaignClients.find((client) => client.id === selectedCampaignClientId) ?? campaignClients[0] ?? null;
  const isAdmin = seller?.role === "admin";
  const isSuperAdmin = isAdmin && seller?.email?.trim().toLowerCase() === "matheusgdn94@gmail.com";
  const leadSidebarStyle = { "--lead-sidebar-width": `${leadSidebarWidth}px` } as CSSProperties;

  const metrics = useMemo(() => {
    return {
      active: clients.length,
      international: clients.filter((client) => client.serviceInterest === "plano_internacional").length,
      career: clients.filter((client) => client.serviceInterest === "plano_carreira").length,
      hot: clients.filter((client) => client.status === "quente").length,
      paused: clients.filter((client) => client.botPaused).length,
      scheduled: clients.filter(hasMeetingRecord).length,
      noMeeting: clients.filter((client) => !isArchivedLead(client) && !hasMeetingRecord(client)).length,
      archived: clients.filter(isArchivedLead).length
    };
  }, [clients]);

  const formMetrics = useMemo(() => {
    return {
      total: formSubmissions.length,
      siteA: formSubmissions.filter((item) => item.pageVariant === "site_a").length,
      siteB: formSubmissions.filter((item) => item.pageVariant === "site_b").length,
      whatsappOk: formSubmissions.filter((item) => item.whatsappSent > 0 && item.confirmedMessages > 0).length,
      attention: formSubmissions.filter((item) => item.whatsappQueued > 0 || item.whatsappFailed > 0 || item.unconfirmedMessages > 0).length,
      scheduled: formSubmissions.filter((item) => Boolean(item.meetingStartsAt) || item.tags.includes("ec10_reuniao_agendada")).length,
      hot: formSubmissions.filter((item) => item.leadScore >= 82 || item.commercialPriority === "true").length
    };
  }, [formSubmissions]);

  const libertacademyMetrics = useMemo(() => ({
    total: libertacademySubmissions.length,
    routedOne: libertacademySubmissions.filter((item) => item.routedWhatsapp === "553197767223").length,
    routedTwo: libertacademySubmissions.filter((item) => item.routedWhatsapp === "5493512602033").length,
    metaAccepted: libertacademySubmissions.filter((item) => item.metaLeadAccepted).length,
    whatsappOk: libertacademySubmissions.filter((item) => item.whatsappSent > 0 && item.confirmedMessages > 0).length,
    scheduled: libertacademySubmissions.filter((item) => Boolean(item.meetingStartsAt)).length
  }), [libertacademySubmissions]);

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

  async function loadClients(
    nextSearch = search,
    nextService = serviceFilter,
    nextFolder = leadFolder,
    nextBucket = leadBucket,
    nextSellerFilter = sellerFilter,
    nextOrigin = leadOrigin
  ) {
    if (!session || !seller?.active) return;
    const requestId = clientsRequestRef.current + 1;
    clientsRequestRef.current = requestId;
    setLoadingClients(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (nextSearch.trim()) params.set("search", nextSearch.trim());
      params.set("folder", nextFolder);
      params.set("bucket", nextBucket);
      if (nextOrigin !== "todas") params.set("origin", nextOrigin);
      if (nextService !== "todos") params.set("service", nextService);
      if (isAdmin && nextSellerFilter !== "todos") params.set("sellerId", nextSellerFilter);
      const data = await apiJson<{ clients: ClientWithPreview[] }>(`/api/clients?${params.toString()}`);
      if (requestId !== clientsRequestRef.current) return;
      setClients(data.clients);
      setSelectedId((current) => {
        const fallback = data.clients[0]?.id ?? null;
        if (!current) return fallback;
        return data.clients.some((client) => client.id === current) ? current : fallback;
      });
    } catch (err) {
      if (requestId === clientsRequestRef.current) {
        setError(err instanceof Error ? err.message : "Falha ao carregar clientes.");
      }
    } finally {
      if (requestId === clientsRequestRef.current) {
        setLoadingClients(false);
      }
    }
  }

  async function loadCampaignClients(nextSellerFilter = sellerFilter) {
    if (!session || !seller?.active) return;
    const requestId = campaignsRequestRef.current + 1;
    campaignsRequestRef.current = requestId;
    setLoadingCampaigns(true);
    setError(null);
    try {
      const params = new URLSearchParams({ campaigns: "1", folder: "todos", bucket: "todos" });
      if (isAdmin && nextSellerFilter !== "todos") params.set("sellerId", nextSellerFilter);
      const data = await apiJson<{ clients: ClientWithPreview[] }>(`/api/clients?${params.toString()}`);
      if (requestId !== campaignsRequestRef.current) return;
      setCampaignClients(data.clients);
      setSelectedCampaignClientId((current) => {
        if (current && data.clients.some((client) => client.id === current)) return current;
        return data.clients[0]?.id ?? null;
      });
    } catch (err) {
      if (requestId === campaignsRequestRef.current) {
        setError(err instanceof Error ? err.message : "Falha ao carregar os funis das campanhas.");
      }
    } finally {
      if (requestId === campaignsRequestRef.current) setLoadingCampaigns(false);
    }
  }

  async function loadFormSubmissions(nextSearch = formSearch, nextPage = formPageFilter) {
    if (!session || !seller?.active) return;
    const requestId = formsRequestRef.current + 1;
    formsRequestRef.current = requestId;
    setLoadingForms(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("forms", "1");
      if (nextSearch.trim()) params.set("search", nextSearch.trim());
      params.set("page", nextPage);
      const data = await apiJson<{ submissions: FormSubmission[] }>(`/api/clients?${params.toString()}`);
      if (requestId !== formsRequestRef.current) return;
      setFormSubmissions(data.submissions);
    } catch (err) {
      if (requestId === formsRequestRef.current) {
        setError(err instanceof Error ? err.message : "Falha ao carregar formularios.");
      }
    } finally {
      if (requestId === formsRequestRef.current) {
        setLoadingForms(false);
      }
    }
  }

  async function loadLibertacademySubmissions(
    nextSearch = libertacademySearch,
    nextDestination = libertacademyDestination
  ) {
    if (!session || !seller?.active) return;
    const requestId = libertacademyRequestRef.current + 1;
    libertacademyRequestRef.current = requestId;
    setLoadingLibertacademy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ libertacademy: "1", destination: nextDestination });
      if (nextSearch.trim()) params.set("search", nextSearch.trim());
      const data = await apiJson<{ submissions: LibertacademySubmission[] }>(`/api/clients?${params.toString()}`);
      if (requestId !== libertacademyRequestRef.current) return;
      setLibertacademySubmissions(data.submissions);
    } catch (err) {
      if (requestId === libertacademyRequestRef.current) {
        setError(err instanceof Error ? err.message : "Falha ao carregar inscricoes da Libertacademy.");
      }
    } finally {
      if (requestId === libertacademyRequestRef.current) setLoadingLibertacademy(false);
    }
  }

  async function loadMessages(clientId: string) {
    if (!session || conversationMinimized) return;
    const requestId = messagesRequestRef.current + 1;
    messagesRequestRef.current = requestId;
    try {
      const data = await apiJson<{ messages: ChatMessage[] }>(`/api/messages?clientId=${encodeURIComponent(clientId)}`);
      if (requestId !== messagesRequestRef.current) return;
      setMessages(data.messages);
    } catch (err) {
      if (requestId === messagesRequestRef.current) {
        setError(err instanceof Error ? err.message : "Falha ao carregar conversa.");
      }
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
    const requestId = botStatusRequestRef.current + 1;
    botStatusRequestRef.current = requestId;
    const entries = await Promise.all(botInstances.map(async (instance) => {
      try {
        const status = await apiJson<BotStatus>(`/api/bot-status?instanceId=${encodeURIComponent(instance.id)}`);
        return [instance.id, status] as const;
      } catch (err) {
        return [instance.id, {
          status: "offline",
          botInstanceId: instance.id,
          message: err instanceof Error ? err.message : "Nao foi possivel consultar o bot."
        }] as const;
      }
    }));
    if (requestId !== botStatusRequestRef.current) return;
    setBotStatuses(Object.fromEntries(entries));
    setQrVersion(Date.now());
  }

  async function updateClient(patch: ClientPatch) {
    if (!selectedClient) return;
    try {
      const data = await apiJson<{ client: ClientWithPreview }>("/api/update-client", {
        method: "PATCH",
        body: JSON.stringify({ clientId: selectedClient.id, ...patch })
      });
      setClients((current) => current.map((client) => (client.id === data.client.id ? { ...client, ...data.client } : client)));
      setCampaignClients((current) => current.map((client) => (client.id === data.client.id ? { ...client, ...data.client } : client)));
      if (patch.archiveClient || patch.confirmAdhesion) await loadClients();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atualizar cliente.");
    }
  }

  async function updateCampaignClient(clientId: string, patch: ClientPatch) {
    try {
      const data = await apiJson<{ client: ClientWithPreview }>("/api/update-client", {
        method: "PATCH",
        body: JSON.stringify({ clientId, ...patch })
      });
      setCampaignClients((current) => current.map((client) => (client.id === data.client.id ? { ...client, ...data.client } : client)));
      setClients((current) => current.map((client) => (client.id === data.client.id ? { ...client, ...data.client } : client)));
      if (patch.archiveClient || patch.confirmAdhesion) await loadCampaignClients();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atualizar cliente.");
    }
  }

  async function archiveClient(clientId: string) {
    setError(null);
    setNotice(null);
    try {
      await apiJson<{ client: ClientWithPreview }>("/api/update-client", {
        method: "PATCH",
        body: JSON.stringify({ clientId, archiveClient: true })
      });
      setNotice("Lead arquivado. Ele fica disponivel na pasta Arquivados.");
      await Promise.all([loadClients(), loadCampaignClients()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao arquivar lead.");
    }
  }

  async function deleteClient(clientId: string) {
    const target = clients.find((client) => client.id === clientId) ?? campaignClients.find((client) => client.id === clientId);
    const confirmed = window.confirm(`Excluir definitivamente o lead ${target?.name || target?.phone || ""}? Esta acao remove a conversa do CRM.`);
    if (!confirmed) return;

    setError(null);
    setNotice(null);
    try {
      await apiJson(`/api/update-client?clientId=${encodeURIComponent(clientId)}`, { method: "DELETE" });
      setClients((current) => current.filter((client) => client.id !== clientId));
      setCampaignClients((current) => current.filter((client) => client.id !== clientId));
      setSelectedId((current) => (current === clientId ? null : current));
      setNotice("Lead excluido do CRM.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir lead.");
    }
  }

  async function confirmAdhesion(clientId: string) {
    setError(null);
    setNotice(null);
    try {
      const data = await apiJson<{ client: ClientWithPreview }>("/api/update-client", {
        method: "PATCH",
        body: JSON.stringify({ clientId, confirmAdhesion: true })
      });
      setClients((current) => current.map((client) => (client.id === data.client.id ? { ...client, ...data.client } : client)));
      setCampaignClients((current) => current.map((client) => (client.id === data.client.id ? { ...client, ...data.client } : client)));
      setNotice("Adesao confirmada: mensagem de agradecimento enfileirada e evento Meta enviado como cliente ideal.");
      if (selectedClient?.id === clientId) await loadMessages(clientId);
      await Promise.all([loadClients(), loadCampaignClients()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao confirmar adesao.");
    }
  }

  async function updateClientStatus(clientId: string, status: LeadStatus) {
    try {
      const data = await apiJson<{ client: ClientWithPreview }>("/api/update-client", {
        method: "PATCH",
        body: JSON.stringify({ clientId, status })
      });
      setClients((current) => current.map((client) => (client.id === data.client.id ? { ...client, ...data.client } : client)));
      setCampaignClients((current) => current.map((client) => (client.id === data.client.id ? { ...client, ...data.client } : client)));
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
    return `crm:leads:tools-visible:v2:${sellerId}`;
  }

  function toggleLeadTools() {
    setLeadToolsVisible((current) => {
      const next = !current;
      if (seller?.id) window.localStorage.setItem(leadToolsStorageKey(seller.id), String(next));
      return next;
    });
  }

  function startLeadSidebarResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leadSidebarWidth;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.round(Math.min(560, Math.max(300, startWidth + moveEvent.clientX - startX)));
      setLeadSidebarWidth(nextWidth);
    };

    const stopResize = () => {
      document.body.classList.remove("wa-resizing-sidebar");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("blur", stopResize);
    };

    document.body.classList.add("wa-resizing-sidebar");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize, { once: true });
    window.addEventListener("blur", stopResize, { once: true });
  }

  useEffect(() => {
    loadMe(false).finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(leadSidebarWidthStorageKey, String(leadSidebarWidth));
  }, [leadSidebarWidth]);

  useEffect(() => {
    if (!seller?.id) return;
    const storedPreference = window.localStorage.getItem(leadToolsStorageKey(seller.id));
    setLeadToolsVisible(storedPreference === null ? true : storedPreference === "true");
  }, [seller?.id]);

  useEffect(() => {
    if (!session || !seller?.active) return;
    if (viewMode === "bh_prime") return;

    const refreshWorkspace = () => {
      if (document.visibilityState !== "visible") return;
      if (viewMode === "campanhas") void loadCampaignClients();
      else void loadClients();
      void loadBotStatus();
    };

    refreshWorkspace();
    if (isAdmin) void loadSellers();
    const workspaceTimer = window.setInterval(refreshWorkspace, 30000);
    document.addEventListener("visibilitychange", refreshWorkspace);

    return () => {
      window.clearInterval(workspaceTimer);
      document.removeEventListener("visibilitychange", refreshWorkspace);
    };
  }, [session, seller?.active, seller?.role, viewMode, leadFolder, leadBucket, serviceFilter, sellerFilter, leadOrigin]);

  useEffect(() => {
    if (!session || !seller?.active || viewMode !== "formularios") return;

    const refreshForms = () => {
      if (document.visibilityState !== "visible") return;
      void loadFormSubmissions();
    };

    refreshForms();
    const formsTimer = window.setInterval(refreshForms, 60000);
    document.addEventListener("visibilitychange", refreshForms);
    return () => {
      window.clearInterval(formsTimer);
      document.removeEventListener("visibilitychange", refreshForms);
    };
  }, [session, seller?.active, viewMode, formPageFilter]);

  useEffect(() => {
    if (!session || !seller?.active || viewMode !== "libertacademy") return;
    const refreshLibertacademy = () => {
      if (document.visibilityState !== "visible") return;
      void loadLibertacademySubmissions();
    };
    refreshLibertacademy();
    const timer = window.setInterval(refreshLibertacademy, 60000);
    document.addEventListener("visibilitychange", refreshLibertacademy);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshLibertacademy);
    };
  }, [session, seller?.active, viewMode, libertacademyDestination]);

  useEffect(() => {
    if (!session || !seller?.active || viewMode !== "bot") return;
    const refreshWhatsAppConnection = () => {
      if (document.visibilityState !== "visible") return;
      void loadBotStatus();
    };
    refreshWhatsAppConnection();
    const timer = window.setInterval(refreshWhatsAppConnection, 10_000);
    document.addEventListener("visibilitychange", refreshWhatsAppConnection);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhatsAppConnection);
    };
  }, [session, seller?.active, viewMode]);

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
    <main className={`app-shell${viewMode === "bh_prime" ? " bh-prime-shell" : ""}`}>
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
          <button className={viewMode === "campanhas" ? "active" : ""} onClick={() => { setViewMode("campanhas"); loadCampaignClients(); }}>
            <Columns3 size={18} /> Funis por campanha
          </button>
          {isAdmin ? (
            <button className={viewMode === "bh_prime" ? "active" : ""} onClick={() => setViewMode("bh_prime")}>
              <TrendingUp size={18} /> BH Prime · gastos
            </button>
          ) : null}
          {isAdmin ? (
            <button className={viewMode === "trafego" ? "active" : ""} onClick={() => setViewMode("trafego")}>
              <TrendingUp size={18} /> Trafego IA
            </button>
          ) : null}
          {isAdmin ? (
            <button className={viewMode === "vendedores" ? "active" : ""} onClick={() => { setViewMode("vendedores"); loadSellers(); }}>
              <UserCheck size={18} /> Vendedores
            </button>
          ) : null}
          <button className={viewMode === "bot" ? "active" : ""} onClick={() => setViewMode("bot")}>
            <Bot size={18} /> Bot
          </button>
          {isSuperAdmin ? (
            <button className={viewMode === "bot_lab" ? "active" : ""} onClick={() => setViewMode("bot_lab")}>
              <FlaskConical size={18} /> Laboratorio IA
            </button>
          ) : null}
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
          {viewMode !== "leads" && viewMode !== "formularios" && viewMode !== "libertacademy" && viewMode !== "campanhas" && viewMode !== "bh_prime" ? (
            <form className="search" onSubmit={(event) => { event.preventDefault(); loadClients(search, serviceFilter, leadFolder); }}>
              <Search size={18} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente, telefone, servico ou anotacao" />
            </form>
          ) : null}
        </header>

        {error ? <div className="error-banner">{error}</div> : null}
        {notice ? <div className="notice-banner">{notice}</div> : null}

        {viewMode === "formularios" ? (
          <FormsPanel
            submissions={formSubmissions}
            metrics={formMetrics}
            loading={loadingForms}
            search={formSearch}
            pageFilter={formPageFilter}
            onSearchChange={setFormSearch}
            onPageFilterChange={(value) => {
              setFormPageFilter(value);
              loadFormSubmissions(formSearch, value);
            }}
            onRefresh={() => loadFormSubmissions()}
            onSubmitSearch={(event) => {
              event.preventDefault();
              loadFormSubmissions();
            }}
            onOpenLead={(clientId) => {
              setSelectedId(clientId);
              setLeadFolder("todos");
              setLeadBucket("todos");
              setLeadOrigin("todas");
              setServiceFilter("todos");
              setViewMode("leads");
              loadClients("", "todos", "todos", "todos", sellerFilter, "todas");
            }}
          />
        ) : null}

        {viewMode === "libertacademy" ? (
          <LibertacademyPanel
            submissions={libertacademySubmissions}
            metrics={libertacademyMetrics}
            loading={loadingLibertacademy}
            search={libertacademySearch}
            destination={libertacademyDestination}
            onSearchChange={setLibertacademySearch}
            onDestinationChange={(value) => {
              setLibertacademyDestination(value);
              loadLibertacademySubmissions(libertacademySearch, value);
            }}
            onSubmitSearch={(event) => {
              event.preventDefault();
              loadLibertacademySubmissions();
            }}
            onRefresh={() => loadLibertacademySubmissions()}
            onOpenLead={(clientId) => {
              setSelectedId(clientId);
              setLeadFolder("todos");
              setLeadBucket("todos");
              setLeadOrigin("todas");
              setServiceFilter("todos");
              setViewMode("leads");
              loadClients("", "todos", "todos", "todos", sellerFilter, "todas");
            }}
          />
        ) : null}

        {viewMode === "bot" ? (
          <BotPanel botStatuses={botStatuses} qrVersion={qrVersion} onRefresh={loadBotStatus} />
        ) : null}

        {viewMode === "bot_lab" && isSuperAdmin ? <BotLabPanel /> : null}

        {viewMode === "vendedores" && isAdmin ? (
          <SellersPanel sellers={sellers} onApprove={approveSeller} onRefresh={loadSellers} />
        ) : null}

        {viewMode === "servicos" ? (
          <ServicesPanel clients={clients} onFilter={(service) => { setServiceFilter(service); loadClients(search, service, leadFolder); setViewMode("leads"); }} />
        ) : null}

        {viewMode === "trafego" ? (
          <TrafficPanel isAdmin={isAdmin} />
        ) : null}
        {viewMode === "bh_prime" && isAdmin ? <BhPrimeManager /> : null}

        {viewMode === "campanhas" ? (
          <CampaignFunnelsPanel
            key={activeCampaign}
            clients={campaignClients}
            sellers={sellers}
            isAdmin={isAdmin}
            loading={loadingCampaigns}
            activeCampaign={activeCampaign}
            sellerFilter={sellerFilter}
            selectedClient={selectedCampaignClient}
            onCampaignChange={(campaign) => {
              setActiveCampaign(campaign);
              const first = campaignClients.find((client) => campaign === "todos" || resolveCampaignKey(client) === campaign);
              setSelectedCampaignClientId(first?.id ?? null);
            }}
            onSellerFilterChange={(value) => {
              setSellerFilter(value);
              loadCampaignClients(value);
            }}
            onRefresh={() => loadCampaignClients()}
            onSelect={setSelectedCampaignClientId}
            onMove={updateClientStatus}
            onUpdate={updateCampaignClient}
            onArchive={archiveClient}
            onDelete={deleteClient}
            onConfirmAdhesion={confirmAdhesion}
            onOpenConversation={(clientId) => {
              setSelectedId(clientId);
              setLeadFolder("todos");
              setLeadBucket("todos");
              setLeadOrigin("todas");
              setServiceFilter("todos");
              setViewMode("leads");
              loadClients("", "todos", "todos", "todos", sellerFilter, "todas");
            }}
          />
        ) : null}

        {viewMode === "pipeline" ? (
          <PipelinePanel
            clients={clients}
            sellers={sellers}
            isAdmin={isAdmin}
            sellerFilter={sellerFilter}
            selectedClient={selectedClient}
            onSellerFilterChange={(value) => { setSellerFilter(value); loadClients(search, serviceFilter, leadFolder, leadBucket, value); }}
            onSelect={setSelectedId}
            onMove={updateClientStatus}
            onUpdate={updateClient}
            onArchive={archiveClient}
            onDelete={deleteClient}
            onConfirmAdhesion={confirmAdhesion}
          />
        ) : null}

        {viewMode === "leads" ? (
          <section className="wa-crm-shell" style={leadSidebarStyle}>
            <aside className="wa-sidebar-panel">
              <div className="wa-sidebar-header">
                <div className="wa-sidebar-title">
                  <strong>
                    Conversas
                    <span className="wa-count-pill">{clients.length}</span>
                  </strong>
                  <small>{loadingClients ? "Atualizando lista" : `${leadFolderLabel[leadFolder]} - ${leadBucketLabel[leadBucket]}`}</small>
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
                    {leadToolsVisible ? <Filter size={18} /> : <Eye size={18} />}
                  </button>
                  <button
                    className="wa-icon-button"
                    type="button"
                    onClick={() => {
                      setLeadToolsVisible(true);
                      setManualLeadOpen((current) => !current);
                    }}
                    title="Novo lead manual"
                  >
                    <Plus size={18} />
                  </button>
                  <button className="wa-icon-button" type="button" onClick={() => loadClients(search, serviceFilter, leadFolder, leadBucket, sellerFilter, leadOrigin)} title="Atualizar">
                    <RefreshCw size={18} className={loadingClients ? "spin" : ""} />
                  </button>
                </div>
              </div>

              <div className={`wa-sidebar-tools ${leadToolsVisible ? "visible" : "hidden"}`} aria-hidden={!leadToolsVisible}>
                {leadToolsVisible ? (
                  <>
                    <form className="wa-search" onSubmit={(event) => { event.preventDefault(); loadClients(search, serviceFilter, leadFolder); }}>
                      <Search size={17} />
                      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar lead, tag ou número..." />
                    </form>

                    <div className="wa-filter-block">
                      <div className="wa-filter-label">
                        <CalendarDays size={12} />
                        Status
                      </div>
                      <div className="wa-segment-row">
                        <FilterChip active={leadBucket === "ativos"} onClick={() => { setLeadBucket("ativos"); loadClients(search, serviceFilter, leadFolder, "ativos", sellerFilter, leadOrigin); }}>
                          Todos
                        </FilterChip>
                        <FilterChip active={leadBucket === "sem_agenda"} onClick={() => { setLeadBucket("sem_agenda"); loadClients(search, serviceFilter, leadFolder, "sem_agenda", sellerFilter, leadOrigin); }}>
                          Sem Agenda
                        </FilterChip>
                        <FilterChip active={leadBucket === "agendados"} tone="success" onClick={() => { setLeadBucket("agendados"); loadClients(search, serviceFilter, leadFolder, "agendados", sellerFilter, leadOrigin); }}>
                          Agendados
                        </FilterChip>
                      </div>
                    </div>

                    <div className="wa-filter-block">
                      <div className="wa-filter-label">
                        <Globe2 size={12} />
                        Origem
                      </div>
                      <div className="wa-segment-row">
                        {(Object.keys(leadOriginLabel) as LeadOriginFilter[]).map((origin) => (
                          <FilterChip
                            key={origin}
                            active={leadOrigin === origin}
                            tone={origin === "instagram" ? "purple" : undefined}
                            onClick={() => {
                              setLeadOrigin(origin);
                              loadClients(search, serviceFilter, leadFolder, leadBucket, sellerFilter, origin);
                            }}
                          >
                            {leadOriginLabel[origin]}
                          </FilterChip>
                        ))}
                      </div>
                    </div>

                    <div className="wa-advanced-filters">
                      <select aria-label="Pasta de leads" value={leadFolder} onChange={(event) => { const value = event.target.value as LeadFolder; setLeadFolder(value); loadClients(search, serviceFilter, value, leadBucket, sellerFilter, leadOrigin); }}>
                        <option value="ec10">{leadFolderLabel.ec10}</option>
                        <option value="revela">{leadFolderLabel.revela}</option>
                        <option value="todos">{leadFolderLabel.todos}</option>
                      </select>
                      <select value={serviceFilter} onChange={(event) => { const value = event.target.value as ServiceInterest | "todos"; setServiceFilter(value); loadClients(search, value, leadFolder, leadBucket, sellerFilter, leadOrigin); }}>
                        <option value="todos">Todos os servicos</option>
                        {serviceOptions.map((service) => <option key={service} value={service}>{serviceLabel[service]}</option>)}
                      </select>
                    </div>

                    {isAdmin ? (
                      <div className="wa-filter-line">
                        <select aria-label="Vendedor" value={sellerFilter} onChange={(event) => { const value = event.target.value; setSellerFilter(value); loadClients(search, serviceFilter, leadFolder, leadBucket, value, leadOrigin); }}>
                          <option value="todos">Todos vendedores</option>
                          {sellers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                        </select>
                        <span>{sellerFilter === "todos" ? "Admin" : "Filtrado"}</span>
                      </div>
                    ) : null}

                    <div className="wa-mini-metrics">
                      <Metric icon={<UsersRound size={17} />} label="Leads" value={String(metrics.active)} />
                      <Metric icon={<Globe2 size={17} />} label="Internacional" value={String(metrics.international)} />
                      <Metric icon={<CalendarDays size={17} />} label="Agendados" value={String(metrics.scheduled)} />
                      <Metric icon={<Archive size={17} />} label="Arquivados" value={String(metrics.archived)} />
                    </div>

                    <details
                      id="new-lead-manual"
                      className="wa-new-lead"
                      open={manualLeadOpen}
                      onToggle={(event) => setManualLeadOpen(event.currentTarget.open)}
                    >
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

            <button
              className="wa-sidebar-resize"
              type="button"
              onPointerDown={startLeadSidebarResize}
              onDoubleClick={() => setLeadSidebarWidth(360)}
              title="Ajustar largura da lista de conversas"
              aria-label="Ajustar largura da lista de conversas"
            />

            <LeadDetail
              client={selectedClient}
              messages={messages}
              draft={draft}
              sending={sending}
              minimized={conversationMinimized}
              crmDrawerVisible={leadCrmDrawerVisible}
              onDraftChange={setDraft}
              onSubmitMessage={sendMessage}
              onToggleMinimized={() => setConversationMinimized((current) => !current)}
              onToggleCrmDrawer={() => setLeadCrmDrawerVisible((current) => !current)}
              onUpdate={updateClient}
              onResetBot={resetClientBot}
              resettingBot={selectedClient ? resettingBotIds.has(selectedClient.id) : false}
              sellers={sellers}
              isAdmin={isAdmin}
              onArchive={archiveClient}
              onDelete={deleteClient}
              onConfirmAdhesion={confirmAdhesion}
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

function normalizeForSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function formatLongDateTime(value: string | null | undefined) {
  if (!value) return "Sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem data";
  return date.toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).replace(".", "");
}

function getPreviewText(client: ClientWithPreview) {
  if (isAudioMessageType(client.lastMessage?.mediaType)) return "Audio recebido";
  if (client.lastMessage?.body) return client.lastMessage.body;
  if (client.notes) return client.notes;
  return "Sem historico recente";
}

function hasMeetingRecord(client: ClientRecord) {
  if (client.meetingStartsAt) return true;
  return Boolean(client.tags?.some((tag) => [
    "bot_meeting_scheduled",
    "reuniao_agendada",
    "ec10_reuniao_agendada",
    "mentoria_prime_reuniao_agendada"
  ].includes(tag)));
}

function hasScheduledMeeting(client: ClientRecord) {
  return hasMeetingRecord(client);
}

function isArchivedLead(client: ClientRecord) {
  if (client.archivedAt) return true;
  if (client.tags?.some((tag) => ["crm_arquivado", "crm_arquivado_pre_2026_06_20", "crm_excluido_manual"].includes(tag))) return true;
  return new Date(client.createdAt).getTime() < new Date(`${workStartDate}T00:00:00-03:00`).getTime();
}

function getLeadVisualState(client: ClientRecord) {
  if (isArchivedLead(client)) return "archived";
  if (hasScheduledMeeting(client)) return "scheduled";
  return "needs-schedule";
}

function buildLeadSourceText(client: ClientRecord) {
  const metadata = client.attributionMetadata ?? {};
  const metadataValues = Object.values(metadata)
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  return [
    client.utmSource,
    client.utmMedium,
    client.utmCampaign,
    client.utmContent,
    client.trafficSource,
    client.source,
    metadataValues,
    ...(client.tags ?? [])
  ].join(" ").toLowerCase();
}

function getLeadPageVariant(client: ClientRecord): "site_a" | "site_b" | null {
  const metadata = client.attributionMetadata ?? {};
  const pagePathText = [metadata.sourcePath, metadata.eventSourceUrl]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (pagePathText.includes("cadastro-plano-carreira")) {
    return "site_b";
  }
  if (pagePathText.includes("/instagram")) {
    return "site_a";
  }

  const variantText = [metadata.landingVariant, metadata.formVariant, metadata.requestedFlow]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (
    variantText.includes("career_plan_full")
    || variantText.includes("career_plan_registration")
    || variantText.includes("cadastro_plano_carreira")
  ) {
    return "site_b";
  }
  if (variantText.includes("instagram")) return "site_a";

  const tags = (client.tags ?? []).map((tag) => tag.toLowerCase());
  if (tags.includes("lp_cadastro_plano_carreira")) return "site_b";
  if (tags.some((tag) => ["lp_instagram", "instagram", "lead_instagram", "origem_instagram"].includes(tag))) {
    return "site_a";
  }

  const sourceText = buildLeadSourceText(client);
  if (sourceText.includes("cadastro-plano-carreira")) return "site_b";
  if (sourceText.includes("/instagram")) {
    return "site_a";
  }
  return null;
}

function getLeadOriginLabel(client: ClientRecord) {
  const sourceText = buildLeadSourceText(client);
  const leadPageVariant = getLeadPageVariant(client);

  if (leadPageVariant === "site_a") return "Site A - Instagram";
  if (leadPageVariant === "site_b") return "Site B - Ficha completa";
  if (sourceText.includes("instagram")) return "Instagram Ads";
  if (client.tags?.includes("campanha_revela_prioritario")) return "Revela";
  if (client.source === "site") return "Site";
  if (client.source === "manual") return "Manual";
  if (client.source === "indicacao") return "Indicação";
  return "WhatsApp";
}

function getLeadServiceLabel(client: ClientRecord) {
  const tags = (client.tags ?? []).map((tag) => tag.toLowerCase());
  const metadata = client.attributionMetadata ?? {};
  const formType = String(metadata.formType ?? "").toLowerCase();
  const formVariant = String(metadata.formVariant ?? "").toLowerCase();

  if (tags.includes("eurocamp") || formType.includes("eurocamp") || formVariant.includes("eurocamp")) {
    return "EC10 Eurocamp";
  }
  return serviceLabel[client.serviceInterest];
}

function getMeetingBadge(client: ClientRecord) {
  if (isArchivedLead(client)) return { label: "Arquivado", className: "archived" };
  if (!hasMeetingRecord(client)) return { label: "Sem agenda", className: "pending-schedule" };
  if (!client.meetingStartsAt) return { label: "Agendado", className: "scheduled" };

  const date = new Date(client.meetingStartsAt);
  if (Number.isNaN(date.getTime())) return { label: "Agendado", className: "scheduled" };

  const today = new Date();
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === today.toDateString()) {
    return { label: `Reunião hoje ${time}`, className: "scheduled" };
  }

  return {
    label: `Reunião ${date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`,
    className: "scheduled"
  };
}

function getLeadTemperatureTag(client: ClientRecord) {
  const qualificationTier = String(client.attributionMetadata?.qualificationTier ?? "");
  if (qualificationTier === "eurocamp_decisor_pendente") return { label: "Decisor pendente", className: "warm" };
  if (qualificationTier === "eurocamp_followup_pendente") return { label: "Follow-up Eurocamp", className: "warm" };
  if (qualificationTier === "eurocamp_qualificado") return { label: "Eurocamp qualificado", className: "warm" };
  if (qualificationTier === "eurocamp_prioritario") return { label: "Eurocamp prioritario", className: "hot" };
  if (qualificationTier === "plano_carreira_sem_recurso_eurocamp") return { label: "Alternativa acessivel", className: "warm" };
  const score = client.leadScore ?? 0;
  if (client.status === "perdido") return { label: "Faltou", className: "danger" };
  if (score >= 82) return { label: "Quente", className: "hot" };
  if (score >= 70) return { label: "Morno", className: "warm" };
  return null;
}

function parseVideoUrlLines(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      try {
        const url = new URL(item);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    })
    .slice(0, 8);
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

function isConfirmedWhatsAppMessage(message: ChatMessage) {
  return message.direction !== "outbound" || Number(message.whatsappAck ?? -1) >= 1;
}

function messageDeliveryLabel(message: ChatMessage) {
  if (message.direction !== "outbound") return null;
  if (isConfirmedWhatsAppMessage(message)) return "Confirmado no WhatsApp";
  if (message.whatsappMessageId) return "Aguardando ACK do WhatsApp";
  return "Nao confirmado no WhatsApp";
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
  const visualState = getLeadVisualState(client);
  const meetingBadge = getMeetingBadge(client);
  const temperatureTag = getLeadTemperatureTag(client);
  const originLabel = getLeadOriginLabel(client);
  const leadServiceLabel = getLeadServiceLabel(client);

  return (
    <article className={`wa-lead-card ${visualState} ${selected ? "selected" : ""} ${minimized ? "minimized" : ""}`}>
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
              <small className={meetingBadge.className}>{meetingBadge.label}</small>
              <small className="origin">{originLabel}</small>
              <small className="service">{leadServiceLabel}</small>
              {client.botPaused ? <small className="danger">Bot pausado</small> : null}
              {temperatureTag ? <small className={temperatureTag.className}>{temperatureTag.label}</small> : null}
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
  crmDrawerVisible,
  sellers,
  isAdmin,
  onDraftChange,
  onSubmitMessage,
  onToggleMinimized,
  onToggleCrmDrawer,
  onUpdate,
  onResetBot,
  resettingBot,
  onArchive,
  onDelete,
  onConfirmAdhesion
}: {
  client: ClientWithPreview | null;
  messages: ChatMessage[];
  draft: string;
  sending: boolean;
  minimized: boolean;
  crmDrawerVisible: boolean;
  sellers: SellerRecord[];
  isAdmin: boolean;
  onDraftChange: (value: string) => void;
  onSubmitMessage: (event: FormEvent<HTMLFormElement>) => void;
  onToggleMinimized: () => void;
  onToggleCrmDrawer: () => void;
  onUpdate: (patch: ClientPatch) => void;
  onResetBot: (clientId: string) => void;
  resettingBot: boolean;
  onArchive: (clientId: string) => void;
  onDelete: (clientId: string) => void;
  onConfirmAdhesion: (clientId: string) => void;
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
          <span>{client.phone} - {getLeadServiceLabel(client)}</span>
          </div>
        </div>
        <div className="wa-chat-actions">
          <button
            className={`wa-icon-button ${crmDrawerVisible ? "active" : ""}`}
            type="button"
            onClick={onToggleCrmDrawer}
            title={crmDrawerVisible ? "Ocultar CRM do lead" : "Mostrar CRM do lead"}
            aria-pressed={crmDrawerVisible}
          >
            {crmDrawerVisible ? <EyeOff size={18} /> : <Headphones size={18} />}
          </button>
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

      <div className={`wa-chat-grid lead-workspace ${crmDrawerVisible ? "crm-open" : "crm-closed"}`}>
        {!crmDrawerVisible ? (
          <button className="wa-crm-show-tab" type="button" onClick={onToggleCrmDrawer}>
            <Headphones size={17} />
            CRM
          </button>
        ) : null}

        {crmDrawerVisible ? (
        <aside className="wa-crm-drawer lead-notes">
          <div className="wa-crm-card lead-stage">
            <div className="wa-crm-title">
              <Headphones size={17} />
              <strong>CRM do lead</strong>
              <button className="wa-icon-button crm-drawer-close" type="button" onClick={onToggleCrmDrawer} title="Ocultar CRM do lead">
                <EyeOff size={16} />
              </button>
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
            {isAdmin ? (
              <label>
                Vendedor responsavel
                <select value={client.assignedSellerId ?? ""} onChange={(event) => onUpdate({ assignedSellerId: event.target.value || null })}>
                  <option value="">Sem vendedor</option>
                  {sellers.map((seller) => <option value={seller.id} key={seller.id}>{seller.name}</option>)}
                </select>
              </label>
            ) : null}
            <button className={client.botPaused ? "resume" : ""} type="button" onClick={() => onUpdate({ botPaused: !client.botPaused })}>
              <Bot size={17} />
              {client.botPaused ? "Retomar bot" : "Pausar bot"}
            </button>
            <button className="reset-bot-command" type="button" onClick={() => onResetBot(client.id)} disabled={resettingBot}>
              {resettingBot ? <Loader2 className="spin" size={17} /> : <RotateCcw size={17} />}
              {resettingBot ? "Resetando..." : "Resetar bot"}
            </button>
            <button className="confirm-adhesion-command" type="button" onClick={() => onConfirmAdhesion(client.id)}>
              <CheckCircle2 size={17} />
              Confirmar adesao
            </button>
          </div>
          <div className="wa-crm-card agenda-card">
            <div className="wa-crm-title">
              <CalendarDays size={17} />
              <strong>Agenda</strong>
            </div>
            {hasScheduledMeeting(client) ? (
              <>
                <small>{formatLongDateTime(client.meetingStartsAt)}</small>
                <small>{client.meetingSellerName || "Vendedor nao identificado"}</small>
                {client.meetingMeetUrl ? <a href={client.meetingMeetUrl} target="_blank" rel="noreferrer">Abrir Google Meet</a> : null}
              </>
            ) : (
              <small className="pending-schedule-text">Ainda sem reuniao marcada. Trabalhar este lead no funil geral.</small>
            )}
          </div>
          <label>
            Anotacoes do vendedor
            <textarea key={`notes-${client.id}`} defaultValue={client.notes ?? ""} onBlur={(event) => onUpdate({ notes: event.target.value })} placeholder="Resumo da conversa, dores, objecoes e proximo passo." />
          </label>
          <label>
            Nome do atleta
            <input
              key={`athlete-${client.id}`}
              defaultValue={client.athleteName ?? ""}
              onBlur={(event) => onUpdate({ athleteName: event.target.value })}
              placeholder="Nome do atleta para personalizar atendimento"
            />
          </label>
          <label>
            Links de videos do atleta
            <textarea
              key={`videos-${client.id}`}
              defaultValue={(client.athleteVideoUrls ?? []).join("\n")}
              onBlur={(event) => onUpdate({ athleteVideoUrls: parseVideoUrlLines(event.target.value) })}
              placeholder="Cole um link por linha: YouTube, Drive, Instagram, Hudl..."
            />
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
          <div className="lead-danger-zone">
            <button type="button" onClick={() => onArchive(client.id)}>
              <Archive size={16} /> Arquivar
            </button>
            <button type="button" className="danger" onClick={() => onDelete(client.id)}>
              <Trash2 size={16} /> Excluir
            </button>
          </div>
        </aside>
        ) : null}

        {!minimized ? (
          <section className="wa-message-panel conversation-thread">
            <div className="wa-messages messages">
              <span className="wa-day-pill">Hoje</span>
              {messages.map((message) => (
                <article
                  className={`wa-bubble message ${message.direction} ${isAudioMessageType(message.mediaType) ? "audio" : ""} ${isConfirmedWhatsAppMessage(message) ? "wa-confirmed" : "wa-unconfirmed"}`}
                  key={message.id}
                >
                  <span>{messageLabel(message)}</span>
                  <p>{message.body || "Mensagem sem texto"}</p>
                  <footer>
                    {messageDeliveryLabel(message) ? <small>{messageDeliveryLabel(message)}</small> : null}
                    <time>{formatChatTime(message.createdAt)}</time>
                  </footer>
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
  sellers,
  isAdmin,
  sellerFilter,
  selectedClient,
  onSellerFilterChange,
  onSelect,
  onMove,
  onUpdate,
  onArchive,
  onDelete,
  onConfirmAdhesion
}: {
  clients: ClientWithPreview[];
  sellers: SellerRecord[];
  isAdmin: boolean;
  sellerFilter: string;
  selectedClient: ClientWithPreview | null;
  onSellerFilterChange: (sellerId: string) => void;
  onSelect: (id: string) => void;
  onMove: (clientId: string, status: LeadStatus) => void;
  onUpdate: (patch: ClientPatch) => void;
  onArchive: (clientId: string) => void;
  onDelete: (clientId: string) => void;
  onConfirmAdhesion: (clientId: string) => void;
}) {
  const selectedId = selectedClient?.id ?? null;
  const activeClients = clients.filter((client) => !isArchivedLead(client));
  const unscheduled = activeClients.filter((client) => !hasScheduledMeeting(client));
  const scheduled = activeClients.filter(hasScheduledMeeting);
  const sellerCards = (isAdmin ? sellers : []).map((seller) => {
    const owned = activeClients.filter((client) => client.assignedSellerId === seller.id);
    return {
      seller,
      total: owned.length,
      scheduled: owned.filter(hasScheduledMeeting).length,
      unscheduled: owned.filter((client) => !hasScheduledMeeting(client)).length
    };
  });

  return (
    <section className="pipeline-workspace">
      <div className="pipeline-command-bar">
        <div className="pipeline-summary-card general">
          <Archive size={18} />
          <span>Fila geral sem reuniao</span>
          <strong>{unscheduled.length}</strong>
          <small>Trabalhar leads desde {workStartDate.split("-").reverse().join("/")}</small>
        </div>
        <div className="pipeline-summary-card scheduled">
          <CalendarDays size={18} />
          <span>Agendados</span>
          <strong>{scheduled.length}</strong>
          <small>Com vendedor e horario registrados</small>
        </div>
        {isAdmin ? (
          <label className="pipeline-seller-select">
            Vendedor
            <select value={sellerFilter} onChange={(event) => onSellerFilterChange(event.target.value)}>
              <option value="todos">Todos vendedores</option>
              {sellers.map((seller) => <option value={seller.id} key={seller.id}>{seller.name}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      {isAdmin && sellerCards.length ? (
        <div className="seller-pipeline-strip">
          {sellerCards.map((item) => (
            <button
              type="button"
              className={sellerFilter === item.seller.id ? "active" : ""}
              key={item.seller.id}
              onClick={() => onSellerFilterChange(item.seller.id)}
            >
              <UserCheck size={16} />
              <strong>{item.seller.name}</strong>
              <span>{item.total} leads</span>
              <small>{item.scheduled} agendados | {item.unscheduled} sem reuniao</small>
            </button>
          ))}
        </div>
      ) : null}

      <div className="pipeline-stage-layout">
        <div className="pipeline-board enhanced">
          {statusFlow.map((status) => {
            const statusClients = activeClients.filter((client) => client.status === status);
            return (
              <div className="pipeline-column" key={status}>
                <div className="section-heading">
                  <div>
                    <h2>{statusLabel[status]}</h2>
                    <small className="pipeline-stage-help">{statusDescription[status]}</small>
                  </div>
                  <span>{statusClients.length}</span>
                </div>
                {statusClients.map((client) => (
                  <article className={`pipeline-card ${getLeadVisualState(client)} ${client.id === selectedId ? "selected" : ""}`} key={client.id} onClick={() => onSelect(client.id)}>
                    <div className="pipeline-card-head">
                      <strong>{client.name || "Lead WhatsApp"}</strong>
                      <small>{formatChatTime(client.lastMessage?.createdAt ?? client.createdAt)}</small>
                    </div>
                    <span>{getLeadServiceLabel(client)}</span>
                    <small>{client.lastMessage?.body || client.notes || client.phone}</small>
                    <div className="pipeline-card-flags">
                      {hasScheduledMeeting(client) ? <em className="ok">Agendado</em> : <em className="warn">Sem reuniao</em>}
                      {client.athleteVideoUrls?.length ? <em>{client.athleteVideoUrls.length} videos</em> : null}
                      {client.adhesionConfirmedAt ? <em className="ok">Adesao</em> : null}
                    </div>
                    <select value={client.status} onChange={(event) => onMove(client.id, event.target.value as LeadStatus)} onClick={(event) => event.stopPropagation()}>
                      {statusFlow.map((nextStatus) => <option key={nextStatus} value={nextStatus}>{statusLabel[nextStatus]}</option>)}
                    </select>
                  </article>
                ))}
              </div>
            );
          })}
        </div>

        <PipelineInspector
          client={selectedClient}
          sellers={sellers}
          isAdmin={isAdmin}
          onUpdate={onUpdate}
          onArchive={onArchive}
          onDelete={onDelete}
          onConfirmAdhesion={onConfirmAdhesion}
        />
      </div>
    </section>
  );
}

function CampaignFunnelsPanel({
  clients,
  sellers,
  isAdmin,
  loading,
  activeCampaign,
  sellerFilter,
  selectedClient,
  onCampaignChange,
  onSellerFilterChange,
  onRefresh,
  onSelect,
  onMove,
  onUpdate,
  onArchive,
  onDelete,
  onConfirmAdhesion,
  onOpenConversation
}: {
  clients: ClientWithPreview[];
  sellers: SellerRecord[];
  isAdmin: boolean;
  loading: boolean;
  activeCampaign: CampaignFilter;
  sellerFilter: string;
  selectedClient: ClientWithPreview | null;
  onCampaignChange: (campaign: CampaignFilter) => void;
  onSellerFilterChange: (sellerId: string) => void;
  onRefresh: () => void;
  onSelect: (id: string) => void;
  onMove: (clientId: string, status: LeadStatus) => void;
  onUpdate: (clientId: string, patch: ClientPatch) => void;
  onArchive: (clientId: string) => void;
  onDelete: (clientId: string) => void;
  onConfirmAdhesion: (clientId: string) => void;
  onOpenConversation: (clientId: string) => void;
}) {
  const [campaignSearch, setCampaignSearch] = useState("");
  const [stageLimits, setStageLimits] = useState<Partial<Record<LeadStatus, number>>>({});
  const normalizedCampaignSearch = normalizeForSearch(campaignSearch.trim());
  const campaignClientsFiltered = clients.filter((client) => (
    !isArchivedLead(client)
    && (activeCampaign === "todos" || resolveCampaignKey(client) === activeCampaign)
    && (!normalizedCampaignSearch || normalizeForSearch([
      client.name,
      client.phone,
      client.athleteName,
      client.trafficCampaignName,
      client.utmCampaign
    ].filter(Boolean).join(" ")).includes(normalizedCampaignSearch))
  ));
  const currentClient = campaignClientsFiltered.find((client) => client.id === selectedClient?.id)
    ?? campaignClientsFiltered[0]
    ?? null;
  const selectedDefinition = activeCampaign === "todos" ? null : campaignDefinition[activeCampaign];
  const stages = activeCampaign === "todos" ? null : campaignStageCopy[activeCampaign];
  const scheduled = campaignClientsFiltered.filter(hasMeetingRecord).length;
  const negotiating = campaignClientsFiltered.filter((client) => ["aguardando_cliente", "quente"].includes(client.status)).length;
  const closed = campaignClientsFiltered.filter((client) => client.status === "fechado").length;
  const unclassified = clients.filter((client) => resolveCampaignKey(client) === "outros").length;

  return (
    <section className="campaign-funnels">
      <div className="campaign-switcher" aria-label="Selecionar funil da campanha">
        {campaignOrder.map((campaign) => {
          const count = clients.filter((client) => !isArchivedLead(client) && resolveCampaignKey(client) === campaign).length;
          return (
            <button type="button" className={activeCampaign === campaign ? "active" : ""} onClick={() => onCampaignChange(campaign)} key={campaign}>
              {campaignIcon(campaign)}
              <span>{campaignDefinition[campaign].shortTitle}</span>
              <strong>{count}</strong>
            </button>
          );
        })}
      </div>

      <div className="campaign-operations-bar">
        <div className="campaign-brief">
          <div className="campaign-brief-icon">{activeCampaign === "todos" ? <TrendingUp size={22} /> : campaignIcon(activeCampaign)}</div>
          <div>
            <small>{activeCampaign === "todos" ? "Operação comercial completa" : "Funil especializado"}</small>
            <h2>{selectedDefinition?.title ?? "Todos os clientes vindos do tráfego"}</h2>
            <p>{selectedDefinition?.audience ?? "Acompanhe cada contato na campanha correta sem misturar públicos, objetivos ou abordagens comerciais."}</p>
            <span>{selectedDefinition?.objective ?? `${unclassified} leads ainda precisam de classificação comercial.`}</span>
          </div>
        </div>
        <div className="campaign-toolbar">
          <label className="campaign-search">
            Buscar no funil
            <span>
              <Search size={16} />
              <input value={campaignSearch} onChange={(event) => setCampaignSearch(event.target.value)} placeholder="Nome ou WhatsApp" />
            </span>
          </label>
          {isAdmin ? (
            <label>
              Vendedor
              <select value={sellerFilter} onChange={(event) => onSellerFilterChange(event.target.value)}>
                <option value="todos">Toda a equipe</option>
                {sellers.map((seller) => <option value={seller.id} key={seller.id}>{seller.name}</option>)}
              </select>
            </label>
          ) : null}
          <button type="button" className="icon-command" onClick={onRefresh} title="Atualizar funis">
            <RefreshCw size={18} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>

      <div className="campaign-kpis">
        <CampaignKpi label="Leads atribuídos" value={campaignClientsFiltered.length} detail="Nesta campanha" />
        <CampaignKpi label="Em qualificação" value={campaignClientsFiltered.filter((client) => ["novo", "triagem"].includes(client.status)).length} detail="Entrada e diagnóstico" />
        <CampaignKpi label="Com agenda" value={scheduled} detail="Reunião registrada" />
        <CampaignKpi label="Em decisão" value={negotiating} detail="Pós-reunião e negociação" />
        <CampaignKpi label="Convertidos" value={closed} detail="Adesão confirmada" tone="success" />
      </div>

      <div className="campaign-stage-layout">
        <div className="campaign-funnel-board">
          {statusFlow.map((status) => {
            const stageClients = campaignClientsFiltered.filter((client) => client.status === status);
            const stageLimit = stageLimits[status] ?? 18;
            const visibleStageClients = stageClients.slice(0, stageLimit);
            const stage = stages?.[status] ?? { label: statusLabel[status], description: statusDescription[status] };
            return (
              <section className="campaign-funnel-column" key={status}>
                <header>
                  <div>
                    <strong>{stage.label}</strong>
                    <small>{stage.description}</small>
                  </div>
                  <span>{stageClients.length}</span>
                </header>
                <div className="campaign-funnel-cards">
                  {visibleStageClients.map((client) => (
                    <article
                      className={`campaign-lead-card ${getLeadVisualState(client)} ${currentClient?.id === client.id ? "selected" : ""}`}
                      key={client.id}
                      onClick={() => onSelect(client.id)}
                    >
                      <div className="pipeline-card-head">
                        <strong>{client.name || "Lead sem nome"}</strong>
                        <small>{formatChatTime(client.lastMessage?.createdAt ?? client.createdAt)}</small>
                      </div>
                      <span>{campaignDefinition[resolveCampaignKey(client)].title}</span>
                      <small>{client.trafficCampaignName || client.utmCampaign || getLeadOriginLabel(client)}</small>
                      <div className="pipeline-card-flags">
                        {hasMeetingRecord(client) ? <em className="ok">Agendado</em> : <em className="warn">Sem reunião</em>}
                        {(client.leadScore ?? 0) > 0 ? <em>Score {client.leadScore}</em> : null}
                        {client.adhesionConfirmedAt ? <em className="ok">Adesão</em> : null}
                      </div>
                      <select value={client.status} onChange={(event) => onMove(client.id, event.target.value as LeadStatus)} onClick={(event) => event.stopPropagation()}>
                        {statusFlow.map((nextStatus) => {
                          const nextStage = stages?.[nextStatus] ?? { label: statusLabel[nextStatus] };
                          return <option key={nextStatus} value={nextStatus}>{nextStage.label}</option>;
                        })}
                      </select>
                    </article>
                  ))}
                  {stageClients.length > visibleStageClients.length ? (
                    <button
                      className="campaign-show-more"
                      type="button"
                      onClick={() => setStageLimits((current) => ({ ...current, [status]: stageLimit + 18 }))}
                    >
                      Mostrar mais {Math.min(18, stageClients.length - visibleStageClients.length)}
                    </button>
                  ) : null}
                  {!stageClients.length ? <p className="campaign-stage-empty">Nenhum lead nesta etapa.</p> : null}
                </div>
              </section>
            );
          })}
        </div>

        <PipelineInspector
          client={currentClient}
          sellers={sellers}
          isAdmin={isAdmin}
          onUpdate={(patch) => currentClient && onUpdate(currentClient.id, patch)}
          onArchive={onArchive}
          onDelete={onDelete}
          onConfirmAdhesion={onConfirmAdhesion}
          onOpenConversation={onOpenConversation}
        />
      </div>
    </section>
  );
}

function CampaignKpi({ label, value, detail, tone }: { label: string; value: number; detail: string; tone?: "success" }) {
  return (
    <article className={`campaign-kpi ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function PipelineInspector({
  client,
  sellers,
  isAdmin,
  onUpdate,
  onArchive,
  onDelete,
  onConfirmAdhesion,
  onOpenConversation
}: {
  client: ClientWithPreview | null;
  sellers: SellerRecord[];
  isAdmin: boolean;
  onUpdate: (patch: ClientPatch) => void;
  onArchive: (clientId: string) => void;
  onDelete: (clientId: string) => void;
  onConfirmAdhesion: (clientId: string) => void;
  onOpenConversation?: (clientId: string) => void;
}) {
  if (!client) {
    return (
      <aside className="pipeline-inspector empty">
        <Columns3 size={42} />
        <strong>Selecione um lead</strong>
        <span>Clique em um card para editar agenda, servico, videos e fechamento.</span>
      </aside>
    );
  }

  return (
    <aside className={`pipeline-inspector ${getLeadVisualState(client)}`}>
      <div className="pipeline-inspector-head">
        <span className="wa-avatar">{getLeadInitials(client.name || client.phone)}</span>
        <div>
          <strong>{client.name || "Lead WhatsApp"}</strong>
          <small>{client.phone}</small>
        </div>
      </div>

      <div className="pipeline-inspector-actions">
        {onOpenConversation ? (
          <button type="button" onClick={() => onOpenConversation(client.id)}>
            <MessageCircle size={16} /> Abrir conversa
          </button>
        ) : null}
        <button type="button" className="confirm" onClick={() => onConfirmAdhesion(client.id)}>
          <CheckCircle2 size={16} /> Confirmar adesao
        </button>
        <button type="button" onClick={() => onArchive(client.id)}>
          <Archive size={16} /> Arquivar
        </button>
        <button type="button" className="danger" onClick={() => onDelete(client.id)}>
          <Trash2 size={16} /> Excluir
        </button>
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
      {isAdmin ? (
        <label>
          Vendedor
          <select value={client.assignedSellerId ?? ""} onChange={(event) => onUpdate({ assignedSellerId: event.target.value || null })}>
            <option value="">Sem vendedor</option>
            {sellers.map((seller) => <option value={seller.id} key={seller.id}>{seller.name}</option>)}
          </select>
        </label>
      ) : null}
      <label>
        Nome do atleta
        <input key={`pipeline-athlete-${client.id}`} defaultValue={client.athleteName ?? ""} onBlur={(event) => onUpdate({ athleteName: event.target.value })} />
      </label>
      <label>
        Videos do atleta
        <textarea
          key={`pipeline-videos-${client.id}`}
          defaultValue={(client.athleteVideoUrls ?? []).join("\n")}
          onBlur={(event) => onUpdate({ athleteVideoUrls: parseVideoUrlLines(event.target.value) })}
          placeholder="Um link por linha"
        />
      </label>
      <div className="pipeline-agenda-box">
        <CalendarDays size={16} />
        {hasScheduledMeeting(client) ? (
          <div>
            <strong>{formatLongDateTime(client.meetingStartsAt)}</strong>
            <span>{client.meetingSellerName || "Vendedor nao identificado"}</span>
            {client.meetingMeetUrl ? <a href={client.meetingMeetUrl} target="_blank" rel="noreferrer">Abrir Meet</a> : null}
          </div>
        ) : (
          <div>
            <strong>Sem reuniao marcada</strong>
            <span>Lead fica na fila geral ate agendar.</span>
          </div>
        )}
      </div>
    </aside>
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

function FormsPanel({
  submissions,
  metrics,
  loading,
  search,
  pageFilter,
  onSearchChange,
  onPageFilterChange,
  onSubmitSearch,
  onRefresh,
  onOpenLead
}: {
  submissions: FormSubmission[];
  metrics: {
    total: number;
    siteA: number;
    siteB: number;
    whatsappOk: number;
    attention: number;
    scheduled: number;
    hot: number;
  };
  loading: boolean;
  search: string;
  pageFilter: FormPageFilter;
  onSearchChange: (value: string) => void;
  onPageFilterChange: (value: FormPageFilter) => void;
  onSubmitSearch: (event: FormEvent<HTMLFormElement>) => void;
  onRefresh: () => void;
  onOpenLead: (clientId: string) => void;
}) {
  return (
    <section className="forms-panel">
      <div className="forms-command-bar">
        <div>
          <span>Monitoramento de formularios</span>
          <strong>Inscricoes das lead pages do trafego</strong>
        </div>
        <div className="forms-actions">
          <form className="forms-search" onSubmit={onSubmitSearch}>
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Buscar nome, telefone, vendedor ou campanha"
            />
          </form>
          <button className="icon-command" type="button" onClick={onRefresh} title="Atualizar formularios">
            <RefreshCw size={18} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>

      <div className="forms-filter-row">
        <FilterChip active={pageFilter === "todas"} onClick={() => onPageFilterChange("todas")}>
          Todas
        </FilterChip>
        <FilterChip active={pageFilter === "site_a"} tone="purple" onClick={() => onPageFilterChange("site_a")}>
          Site A - Instagram LP
        </FilterChip>
        <FilterChip active={pageFilter === "site_b"} tone="success" onClick={() => onPageFilterChange("site_b")}>
          Site B - Ficha completa
        </FilterChip>
      </div>

      <div className="forms-metrics">
        <Metric icon={<FileText size={18} />} label="Inscricoes" value={String(metrics.total)} />
        <Metric icon={<MessageCircle size={18} />} label="Site A" value={String(metrics.siteA)} />
        <Metric icon={<BriefcaseBusiness size={18} />} label="Site B" value={String(metrics.siteB)} />
        <Metric icon={<CheckCircle2 size={18} />} label="WhatsApp OK" value={String(metrics.whatsappOk)} />
        <Metric icon={<ShieldCheck size={18} />} label="Prioritarios" value={String(metrics.hot)} />
        <Metric icon={<CalendarDays size={18} />} label="Agendados" value={String(metrics.scheduled)} />
      </div>

      <div className="forms-table-shell">
        <table className="forms-table">
          <thead>
            <tr>
              <th>Lead</th>
              <th>Pagina</th>
              <th>Qualificacao</th>
              <th>WhatsApp</th>
              <th>Agenda</th>
              <th>Origem</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {submissions.map((submission) => {
              const delivery = getFormDeliveryState(submission);
              return (
                <tr key={submission.id} className={delivery.tone}>
                  <td>
                    <div className="forms-lead-cell">
                      <span className="wa-avatar">{getLeadInitials(submission.name || submission.phone)}</span>
                      <div>
                        <strong>{submission.name || "Lead sem nome"}</strong>
                        <small>{formatPhoneForDisplay(submission.phone)} · {formatLongDateTime(submission.createdAt)}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`forms-page-pill ${submission.pageVariant}`}>{getFormPageLabel(submission.pageVariant)}</span>
                    <small>{submission.sourcePath || submission.formVariant || "Origem registrada"}</small>
                  </td>
                  <td>
                    <strong>{submission.leadScore}/100</strong>
                    <small>{getRoleLabel(submission.roleAnswer)} · {submission.athleteAge ? `${submission.athleteAge} anos` : "idade pendente"}</small>
                    <small>{getInvestmentLabel(submission.investmentRange)}{submission.videoMaterialStatus ? ` · ${getVideoMaterialLabel(submission.videoMaterialStatus)}` : ""}</small>
                  </td>
                  <td>
                    <span className={`forms-state-pill ${delivery.tone}`}>{delivery.label}</span>
                    <small>{delivery.detail}</small>
                  </td>
                  <td>
                    {submission.meetingStartsAt ? (
                      <>
                        <strong>{formatLongDateTime(submission.meetingStartsAt)}</strong>
                        <small>{submission.meetingSellerName || submission.sellerName || "Vendedor nao identificado"}</small>
                      </>
                    ) : (
                      <>
                        <strong>{statusLabel[submission.status]}</strong>
                        <small>{submission.sellerName || "Sem vendedor"}</small>
                      </>
                    )}
                  </td>
                  <td>
                    <strong>{submission.campaignName || "Campanha nao informada"}</strong>
                    <small>{submission.landingUrl || submission.sourcePath || "Sem URL registrada"}</small>
                  </td>
                  <td>
                    <button className="forms-open-button" type="button" onClick={() => onOpenLead(submission.id)}>
                      Abrir
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!submissions.length && !loading ? <p className="empty-state">Nenhuma inscricao encontrada para este filtro.</p> : null}
        {loading ? <p className="empty-state">Atualizando inscricoes...</p> : null}
      </div>
    </section>
  );
}

function getFormPageLabel(pageVariant: FormSubmission["pageVariant"]) {
  return pageVariant === "site_b" ? "Site B - Ficha completa" : "Site A - Instagram LP";
}

function LibertacademyPanel({
  submissions,
  metrics,
  loading,
  search,
  destination,
  onSearchChange,
  onDestinationChange,
  onSubmitSearch,
  onRefresh,
  onOpenLead
}: {
  submissions: LibertacademySubmission[];
  metrics: { total: number; routedOne: number; routedTwo: number; metaAccepted: number; whatsappOk: number; scheduled: number };
  loading: boolean;
  search: string;
  destination: string;
  onSearchChange: (value: string) => void;
  onDestinationChange: (value: string) => void;
  onSubmitSearch: (event: FormEvent<HTMLFormElement>) => void;
  onRefresh: () => void;
  onOpenLead: (clientId: string) => void;
}) {
  return (
    <section className="liberta-crm-panel">
      <div className="liberta-command-bar">
        <div>
          <span>Campeonato Florianopolis 2027</span>
          <strong>Inscricoes de escolas e academias</strong>
        </div>
        <div className="forms-actions">
          <form className="forms-search" onSubmit={onSubmitSearch}>
            <Search size={17} />
            <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Buscar responsavel, escola, pais ou telefone" />
          </form>
          <button className="icon-command" type="button" onClick={onRefresh} title="Atualizar campeonato">
            <RefreshCw size={18} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>

      <div className="liberta-routing-strip">
        <FilterChip active={destination === "todos"} onClick={() => onDestinationChange("todos")}>Todos</FilterChip>
        <FilterChip active={destination === "553197767223"} tone="success" onClick={() => onDestinationChange("553197767223")}>Atendimento 1</FilterChip>
        <FilterChip active={destination === "5493512602033"} tone="purple" onClick={() => onDestinationChange("5493512602033")}>Atendimento 2</FilterChip>
        <span>Rodizio ativo: o lead inicia a conversa no WhatsApp selecionado.</span>
      </div>

      <div className="liberta-metrics">
        <Metric icon={<Trophy size={18} />} label="Inscricoes" value={String(metrics.total)} />
        <Metric icon={<MessageCircle size={18} />} label="Atendimento 1" value={String(metrics.routedOne)} />
        <Metric icon={<MessageCircle size={18} />} label="Atendimento 2" value={String(metrics.routedTwo)} />
        <Metric icon={<TrendingUp size={18} />} label="Meta recebeu" value={String(metrics.metaAccepted)} />
        <Metric icon={<CheckCircle2 size={18} />} label="Direcionados" value={String(metrics.routedOne + metrics.routedTwo)} />
        <Metric icon={<CalendarDays size={18} />} label="Agendados" value={String(metrics.scheduled)} />
      </div>

      <div className="liberta-card-grid">
        {submissions.map((submission) => {
          const deliveryTone = submission.whatsappFailed > 0 ? "danger" : submission.whatsappQueued > 0 ? "warning" : submission.whatsappSent > 0 && submission.confirmedMessages > 0 ? "success" : "muted";
          const destinationLabel = submission.routedWhatsapp === "553197767223" ? "Atendimento 1" : submission.routedWhatsapp === "5493512602033" ? "Atendimento 2" : "Destino pendente";
          return (
            <article className="liberta-lead-card" key={submission.id}>
              <div className="liberta-card-head">
                <span className="wa-avatar">{getLeadInitials(submission.academy || submission.name || submission.phone)}</span>
                <div>
                  <strong>{submission.academy || "Escola nao informada"}</strong>
                  <small>{submission.country || "Pais nao informado"} · {formatLongDateTime(submission.createdAt)}</small>
                </div>
                <span className={`forms-state-pill ${deliveryTone}`}>{destinationLabel}</span>
              </div>
              <div className="liberta-card-body">
                <div><span>Responsavel</span><strong>{submission.name || "Nao informado"}</strong><small>{formatPhoneForDisplay(submission.phone)}</small></div>
                <div><span>Perfil</span><strong>{submission.contactRole === "proprietario" ? "Proprietario da escola" : submission.contactRole === "gestor" ? "Diretor ou gestor" : "Perfil nao confirmado"}</strong><small>{submission.decisionMakerConfirmed ? "Poder de decisao confirmado" : "Confirmacao pendente"}</small></div>
                <div><span>Interesse</span><strong>{submission.categories.length ? submission.categories.join(", ") : "Categorias a definir"}</strong><small>{submission.athleteCount ? `${submission.athleteCount} atletas estimados` : "Quantidade a definir"}</small></div>
                <div><span>Campanha</span><strong>{submission.utmCampaign || "Organico / sem UTM"}</strong><small>{[submission.utmSource, submission.utmMedium, submission.utmContent].filter(Boolean).join(" · ") || "Origem direta"}</small></div>
              </div>
              <div className="liberta-card-health">
                <span className={submission.metaLeadAccepted ? "ok" : "attention"}><TrendingUp size={14} />{submission.metaLeadAccepted ? "Lead recebido pela Meta" : "Meta sem confirmacao"}</span>
                <span className={deliveryTone === "success" ? "ok" : "attention"}><MessageCircle size={14} />{deliveryTone === "success" ? "Mensagem confirmada" : submission.whatsappQueued ? "Mensagem na fila" : "Confirmacao pendente"}</span>
                <span><ShieldCheck size={14} />Score {submission.leadScore}/100</span>
              </div>
              <button className="forms-open-button" type="button" onClick={() => onOpenLead(submission.id)}>Abrir lead</button>
            </article>
          );
        })}
        {!submissions.length && !loading ? <p className="empty-state">Nenhuma inscricao da Libertacademy encontrada.</p> : null}
        {loading ? <p className="empty-state">Atualizando inscricoes do campeonato...</p> : null}
      </div>
    </section>
  );
}

function getFormDeliveryState(submission: FormSubmission) {
  if (submission.whatsappFailed > 0 || submission.unconfirmedMessages > 0) {
    return {
      label: "Atencao",
      tone: "danger",
      detail: submission.lastError || "Existe envio sem confirmacao real do WhatsApp."
    };
  }
  if (submission.whatsappQueued > 0) {
    return {
      label: "Na fila",
      tone: "warning",
      detail: `${submission.whatsappQueued} mensagem(ns) aguardando o bot.`
    };
  }
  if (submission.whatsappSent > 0 && submission.confirmedMessages > 0) {
    return {
      label: "Enviado",
      tone: "success",
      detail: submission.lastSentAt ? `Confirmado ${formatLongDateTime(submission.lastSentAt)}` : "Confirmado pelo WhatsApp."
    };
  }
  if (submission.whatsappCancelled > 0) {
    return {
      label: "Cancelado",
      tone: "warning",
      detail: submission.lastError || "Envio cancelado por regra de seguranca."
    };
  }
  return {
    label: "Sem disparo",
    tone: "muted",
    detail: "Cadastro sem mensagem automatica registrada."
  };
}

function getRoleLabel(role: string | null) {
  if (role === "atleta") return "Atleta";
  if (role === "responsavel" || role === "Responsavel pelo atleta" || role === "Responsável pelo atleta") return "Responsavel";
  return "Perfil pendente";
}

function getInvestmentLabel(value: string | null) {
  const labels: Record<string, string> = {
    "1000_plus": "+R$ 1.000",
    "600_1000": "R$ 600-1.000",
    "300_600": "R$ 300-600",
    "ate_300": "Ate R$ 300",
    indefinido: "Sem orcamento"
  };
  return value ? labels[value] ?? value : "Investimento pendente";
}

function getVideoMaterialLabel(value: string) {
  if (value === "sem_material") return "sem video";
  if (value === "link_informado") return "video informado";
  return value;
}

function formatPhoneForDisplay(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) {
    const national = digits.slice(2);
    const ddd = national.slice(0, 2);
    const number = national.slice(2);
    return `+55 ${ddd} ${number}`;
  }
  return digits ? `+${digits}` : phone;
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
  botStatuses,
  qrVersion,
  onRefresh
}: {
  botStatuses: Record<string, BotStatus>;
  qrVersion: number;
  onRefresh: () => void;
}) {
  return (
    <section className="bot-grid">
      {botInstances.map((instance) => {
        const botStatus = botStatuses[instance.id] ?? null;
        const status = botStatus?.status ?? "carregando";
        const isReady = !botStatus?.stale && (status === "ready" || status === "authenticated");
        const showQr = !isReady && !botStatus?.stale && (status === "waiting_qr_scan" || Boolean(botStatus?.qrPath));
        const isDisconnected = !isReady && !showQr;
        const qrUrl = `/api/bot-qr?instanceId=${encodeURIComponent(instance.id)}&t=${qrVersion}`;

        return (
          <div className="bot-instance-panel" key={instance.id}>
            <div className="bot-status-panel">
              <div className="section-heading">
                <h2>{botStatus?.botInstanceLabel ?? instance.label}</h2>
                <button className="icon-command" type="button" onClick={onRefresh} title="Atualizar">
                  <RefreshCw size={18} />
                </button>
              </div>
              <strong className={`bot-state ${isReady ? "ready" : ""} ${isDisconnected ? "blocked" : ""}`}>{botStatus?.stale ? "offline" : status}</strong>
              <span>{botStatus?.updatedAt ? new Date(botStatus.updatedAt).toLocaleString("pt-BR") : "Aguardando leitura do servidor"}</span>
              {botStatus?.message ? <p>{botStatus.message}</p> : null}
            </div>

            <div className="qr-panel">
              <BotQrPanel instance={instance} qrUrl={qrUrl} isReady={isReady} canShowQr={showQr} onRefresh={onRefresh} />
            </div>
          </div>
        );
      })}
    </section>
  );
}

function BotQrPanel({
  instance,
  qrUrl,
  isReady,
  canShowQr,
  onRefresh
}: {
  instance: BotInstanceInfo;
  qrUrl: string;
  isReady: boolean;
  canShowQr: boolean;
  onRefresh: () => void;
}) {
  const [qrFailed, setQrFailed] = useState(false);
  const [liveQrVersion, setLiveQrVersion] = useState(Date.now());

  useEffect(() => {
    setQrFailed(false);
    setLiveQrVersion(Date.now());
  }, [qrUrl, canShowQr, isReady]);

  useEffect(() => {
    if (isReady || !canShowQr) return;
    const timer = window.setInterval(() => setLiveQrVersion(Date.now()), 3000);
    return () => window.clearInterval(timer);
  }, [canShowQr, isReady]);

  const liveQrUrl = qrUrl.replace(/([?&])t=\d+/, `$1t=${liveQrVersion}`);

  if (isReady) {
    return (
      <div className="qr-ready">
        <CheckCircle2 size={56} />
        <strong>WhatsApp conectado</strong>
      </div>
    );
  }

  if (canShowQr || !qrFailed) {
    return (
      <div className="qr-live">
        <img
          src={liveQrUrl}
          alt={`QR Code para conectar ${instance.label}`}
          onLoad={() => setQrFailed(false)}
          onError={() => setQrFailed(true)}
        />
        <strong>Escaneie o QR Code no WhatsApp</strong>
        <span>O código é renovado automaticamente. Escaneie assim que ele aparecer.</span>
        <button type="button" onClick={onRefresh}>Atualizar status</button>
      </div>
    );
  }

  return (
    <div className="qr-ready blocked">
      <CirclePause size={56} />
      <strong>WhatsApp desconectado</strong>
      <span>Inicie ou reinicie o bot para gerar um novo QR Code.</span>
      <button type="button" onClick={onRefresh}>Atualizar status</button>
    </div>
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

function FilterChip({
  active,
  tone = "default",
  children,
  onClick
}: {
  active: boolean;
  tone?: "default" | "success" | "purple";
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button className={`wa-filter-chip ${active ? "active" : ""} ${tone}`} type="button" onClick={onClick}>
      {children}
    </button>
  );
}

function pageTitle(viewMode: ViewMode) {
  if (viewMode === "bh_prime") return "EC10 · campanhas BH Prime";
  if (viewMode === "campanhas") return "Funis por campanha";
  if (viewMode === "pipeline") return "Pipeline comercial";
  if (viewMode === "formularios") return "Formularios";
  if (viewMode === "libertacademy") return "Libertacademy";
  if (viewMode === "servicos") return "Servicos vendidos";
  if (viewMode === "vendedores") return "Equipe de vendas";
  if (viewMode === "bot") return "Pareamento do bot";
  if (viewMode === "bot_lab") return "Laboratorio IA do bot";
  if (viewMode === "trafego") return "Central de trafego IA";
  return "Leads do WhatsApp";
}

function pageSubtitle(viewMode: ViewMode) {
  if (viewMode === "bh_prime") return "Investimento protegido, entrega dos criativos e qualidade comercial por produto.";
  if (viewMode === "campanhas") return "Clientes organizados por serviço, público e etapa comercial.";
  if (viewMode === "pipeline") return "Entrada, atendimento, agenda, pos-reuniao, negociacao e fechamento por vendedor.";
  if (viewMode === "formularios") return "Inscricoes das lead pages, origem do trafego e confirmacao real do WhatsApp.";
  if (viewMode === "libertacademy") return "Escolas inscritas, distribuicao do atendimento e sinais enviados para a Meta.";
  if (viewMode === "servicos") return "Separacao dos leads por interesse comercial.";
  if (viewMode === "vendedores") return "Aprove ou bloqueie acessos de vendedores.";
  if (viewMode === "bot") return "Status do WhatsApp e QR Code quando precisar reconectar.";
  if (viewMode === "bot_lab") return "Teste o roteiro, aprove respostas e ensine a IA sem tocar em conversas reais.";
  if (viewMode === "trafego") return "Leads, funil, remarketing, rascunhos e sinais de qualidade para Meta.";
  return "Atendimento, anotacoes, follow-up e envio pelo WhatsApp.";
}
