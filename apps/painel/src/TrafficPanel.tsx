import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock3,
  Download,
  Flame,
  Gauge,
  Link2,
  Megaphone,
  MousePointerClick,
  PieChart as PieChartIcon,
  Radio,
  RefreshCw,
  Rocket,
  Send,
  Sparkles,
  Target,
  TrendingUp,
  UserCheck,
  UsersRound,
  X
} from "lucide-react";
import type { ServiceInterest } from "@crm/shared";
import { BhPrimeManager } from "./BhPrimeManager";

type TrafficMetrics = {
  totalLeads: number;
  whatsappLeads: number;
  careerLeads: number;
  internationalLeads: number;
  hotLeads: number;
  proposals: number;
  closed: number;
  lost: number;
  averageScore: number;
  conversionRate: number;
  hotRate: number;
};

type TrafficEventCount = {
  eventType: string;
  total: number;
};

type TrafficRecommendation = {
  id: string;
  title: string;
  summary: string;
  recommendation_type: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: string;
  confidence: number;
  impact_area: string;
  service_interest: ServiceInterest | string | null;
  age_group: string | null;
  reasoning: string | null;
  created_at: string;
};

type TrafficCampaignDraft = {
  id: string;
  name: string;
  objective: string;
  status: string;
  platform: string;
  service_interest: ServiceInterest | string;
  budget_daily: string | number | null;
  budget_total: string | number | null;
  age_min: number | null;
  age_max: number | null;
  locations: string[];
  interests: string[];
  placements: string[];
  destination_url: string | null;
  whatsapp_message: string | null;
  copy_text: string | null;
  creative_notes: string | null;
  ai_rationale: string | null;
  meta_campaign_id: string | null;
  meta_adset_id: string | null;
  meta_creative_id: string | null;
  meta_ad_id: string | null;
  publish_error: string | null;
  published_at: string | null;
  created_at: string;
};

type TrafficSnapshot = {
  campaign_id: string | null;
  campaign_name: string | null;
  status: string | null;
  spend: string | number | null;
  impressions: number | null;
  clicks: number | null;
  leads: number | null;
  qualified_leads: number | null;
  proposals: number | null;
  purchases: number | null;
};

type TrafficDailyPoint = {
  date: string;
  spend: string | number | null;
  impressions: number | null;
  clicks: number | null;
  leads: number | null;
  qualifiedLeads: number | null;
  proposals: number | null;
  purchases: number | null;
  ctr: string | number | null;
  cpc: string | number | null;
};

type TrafficAdPerformance = {
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  adId: string | null;
  adName: string | null;
  status: string | null;
  spend: string | number | null;
  impressions: number | null;
  clicks: number | null;
  leads: number | null;
  qualifiedLeads: number | null;
  purchases: number | null;
  ctr: string | number | null;
  cpc: string | number | null;
  lastSyncedAt: string | null;
};

type TrafficMeeting = {
  clientId: string;
  clientName: string | null;
  phone: string | null;
  status: string | null;
  serviceInterest: ServiceInterest | string | null;
  sellerId: string | null;
  sellerName: string | null;
  sellerRoute: string | null;
  startsAt: string;
  endsAt: string | null;
  meetUrl: string | null;
  sellerNotified: boolean;
  updatedAt: string | null;
};

type TrafficAttributionHealth = {
  siteLeads: number;
  attributedLeads: number;
  fbpLeads: number;
  fbcLeads: number;
  fbclidLeads: number;
  closedClients: number;
  closedWithAttribution: number;
  qualifiedEvents: number;
  scheduleEvents: number;
  purchaseEvents: number;
  meetingEvents: number;
  attributionRate: number;
  purchaseSignalGap: number;
};

type MetaStatusCheck = {
  name: string;
  ok: boolean;
  status: number;
  message: string | null;
};

type MetaStatus = {
  graphVersion: string;
  configured: {
    adAccount: boolean;
    systemUserToken: boolean;
    pixel: boolean;
    capi: boolean;
  };
  readyForInsights: boolean;
  readyForQualityEvents: boolean;
  checks: MetaStatusCheck[];
  requiredActions: string[];
};

type TrafficOverview = {
  periodDays: number;
  metrics: TrafficMetrics;
  eventCounts: TrafficEventCount[];
  ageGroups: Array<{ ageGroup: string; total: number }>;
  recentEvents: Array<{ id: string; event_type: string; phone: string | null; age_group: string | null; occurred_at: string }>;
  recommendations: TrafficRecommendation[];
  drafts: TrafficCampaignDraft[];
  snapshots: TrafficSnapshot[];
  adPerformance: TrafficAdPerformance[];
  dailySeries: TrafficDailyPoint[];
  meetings: TrafficMeeting[];
  attributionHealth: TrafficAttributionHealth;
};

const emptyOverview: TrafficOverview = {
  periodDays: 30,
  metrics: {
    totalLeads: 0,
    whatsappLeads: 0,
    careerLeads: 0,
    internationalLeads: 0,
    hotLeads: 0,
    proposals: 0,
    closed: 0,
    lost: 0,
    averageScore: 0,
    conversionRate: 0,
    hotRate: 0
  },
  eventCounts: [],
  ageGroups: [],
  recentEvents: [],
  recommendations: [],
  drafts: [],
  snapshots: [],
  adPerformance: [],
  dailySeries: [],
  meetings: [],
  attributionHealth: {
    siteLeads: 0,
    attributedLeads: 0,
    fbpLeads: 0,
    fbcLeads: 0,
    fbclidLeads: 0,
    closedClients: 0,
    closedWithAttribution: 0,
    qualifiedEvents: 0,
    scheduleEvents: 0,
    purchaseEvents: 0,
    meetingEvents: 0,
    attributionRate: 0,
    purchaseSignalGap: 0
  }
};

const serviceLabel: Record<string, string> = {
  plano_internacional: "Plano internacional",
  plano_carreira: "Plano de carreira",
  ambos: "Ambos",
  nao_definido: "Nao definido"
};

const eventLabel: Record<string, string> = {
  whatsapp_inbound: "Entrada WhatsApp",
  bot_started: "Bot iniciado",
  bot_role_captured: "Perfil capturado",
  bot_age_captured: "Idade capturada",
  bot_audio_sent: "Audio enviado",
  bot_link_sent: "Pagina enviada",
  career_plan_bot_activated: "Bot Plano de Carreira",
  mentoria_prime_bot_activated: "Bot Mentoria Prime",
  bot_meeting_scheduled: "Reuniao agendada",
  seller_reply_sent: "Vendedor respondeu",
  qualified_lead: "Lead quente",
  proposal_requested: "Orcamento",
  purchase: "Fechamento",
  lost_lead: "Perdido"
};

const leadStatusLabel: Record<string, string> = {
  novo: "Novo",
  triagem: "Triagem",
  orcamento: "Orcamento",
  aguardando_cliente: "Aguardando",
  quente: "Quente",
  fechado: "Fechado",
  perdido: "Perdido"
};

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

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: unknown) {
  return numberValue(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatCompact(value: unknown) {
  return numberValue(value).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function formatPercent(value: unknown) {
  return `${numberValue(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function formatWeekday(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
}

function formatMeetingDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");
}

function formatMeetingTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function dayKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function localDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateKeyShort(value: string) {
  const date = parseDateKey(value);
  if (!date) return value;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function formatDateKeyWeekday(value: string) {
  const date = parseDateKey(value);
  if (!date) return "";
  return date.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
}

function monthTitle(value: string) {
  const date = parseDateKey(value) ?? new Date();
  return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function barWidth(value: number, max: number) {
  if (!max || value <= 0) return "0%";
  return `${Math.min(100, Math.max(5, (value / max) * 100))}%`;
}

function compactCampaignName(name: string | null) {
  if (!name) return "Campanha sem nome";
  return name.replace(/\s+/g, " ").trim();
}

function shortText(value: string, max = 64) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function isActiveMetaStatus(status: string | null | undefined) {
  return String(status ?? "").toUpperCase() === "ACTIVE";
}

function normalizePercent(value: number, max = 100) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(max, Math.max(0, value));
}

const trafficPalette = ["#55d8ff", "#8b5cf6", "#5bffdb", "#ffd05b", "#ff47a6", "#5bff99"];

export function TrafficPanel({ isAdmin }: { isAdmin: boolean }) {
  const [overview, setOverview] = useState<TrafficOverview>(emptyOverview);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [metaStatus, setMetaStatus] = useState<MetaStatus | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [serviceInterest, setServiceInterest] = useState<ServiceInterest>("plano_carreira");
  const [ageGroup, setAgeGroup] = useState("8-17");
  const [region, setRegion] = useState("Brasil");
  const [budgetDaily, setBudgetDaily] = useState("50");
  const [budgetTotal, setBudgetTotal] = useState("");
  const [goal, setGoal] = useState("gerar conversas qualificadas no WhatsApp");
  const [selectedBudgetSegment, setSelectedBudgetSegment] = useState<string | null>(null);
  const [showAgendaModal, setShowAgendaModal] = useState(false);
  const [selectedMeetingDate, setSelectedMeetingDate] = useState<string | null>(null);
  const [selectedSellerFilter, setSelectedSellerFilter] = useState("Todos");
  const overviewRequestRef = useRef(0);
  const metaStatusRequestRef = useRef(0);

  const eventMap = useMemo(() => {
    return Object.fromEntries(overview.eventCounts.map((item) => [item.eventType, item.total]));
  }, [overview.eventCounts]);

  const segments = useMemo(() => {
    const inbound = numberValue(eventMap.whatsapp_inbound);
    const ageCaptured = numberValue(eventMap.bot_age_captured);
    const linkSent = numberValue(eventMap.bot_link_sent);
    const sellerReplies = numberValue(eventMap.seller_reply_sent);
    const qualified = overview.metrics.hotLeads + numberValue(eventMap.qualified_lead);
    return [
      { title: "Primeiro contato sem idade", value: Math.max(0, inbound - ageCaptured), tone: "warning" },
      { title: "Pagina enviada sem vendedor", value: Math.max(0, linkSent - sellerReplies), tone: "info" },
      { title: "Meio de funil", value: Math.max(0, linkSent - qualified), tone: "neutral" },
      { title: "Lead quente", value: overview.metrics.hotLeads, tone: "hot" },
      { title: "Orcamento", value: overview.metrics.proposals, tone: "success" }
    ];
  }, [eventMap, overview.metrics.hotLeads, overview.metrics.proposals]);

  const mediaSummary = useMemo(() => {
    const spend = overview.snapshots.reduce((sum, item) => sum + numberValue(item.spend), 0);
    const impressions = overview.snapshots.reduce((sum, item) => sum + numberValue(item.impressions), 0);
    const clicks = overview.snapshots.reduce((sum, item) => sum + numberValue(item.clicks), 0);
    const leads = overview.snapshots.reduce((sum, item) => sum + numberValue(item.leads), 0);
    return {
      spend,
      impressions,
      clicks,
      leads,
      ctr: impressions ? (clicks / impressions) * 100 : 0,
      cpc: clicks ? spend / clicks : 0,
      campaigns: overview.snapshots.length
    };
  }, [overview.snapshots]);

  const funnelSteps = useMemo(() => {
    const steps = [
      { label: "Contato", value: numberValue(eventMap.whatsapp_inbound), tone: "neutral" },
      { label: "Boas-vindas", value: numberValue(eventMap.bot_started), tone: "info" },
      { label: "Idade", value: numberValue(eventMap.bot_age_captured), tone: "info" },
      { label: "Pagina", value: numberValue(eventMap.bot_link_sent), tone: "success" },
      { label: "Vendedor", value: numberValue(eventMap.seller_reply_sent), tone: "neutral" },
      { label: "Quente", value: overview.metrics.hotLeads, tone: "hot" },
      { label: "Fechado", value: overview.metrics.closed, tone: "success" }
    ];
    const max = Math.max(1, ...steps.map((item) => item.value));
    return steps.map((item) => ({ ...item, width: barWidth(item.value, max) }));
  }, [eventMap, overview.metrics.closed, overview.metrics.hotLeads]);

  const campaignRows = useMemo(() => {
    const maxSpend = Math.max(1, ...overview.snapshots.map((item) => numberValue(item.spend)));
    const maxClicks = Math.max(1, ...overview.snapshots.map((item) => numberValue(item.clicks)));
    return overview.snapshots
      .map((snapshot) => {
        const spend = numberValue(snapshot.spend);
        const clicks = numberValue(snapshot.clicks);
        const impressions = numberValue(snapshot.impressions);
        const leads = numberValue(snapshot.leads);
        const ctr = impressions ? (clicks / impressions) * 100 : 0;
        const cpc = clicks ? spend / clicks : 0;
        const health = leads > 0
          ? { label: "Gerando leads", tone: "success" }
          : spend > 0 && clicks > 0
            ? { label: "Tem clique, falta lead", tone: "warning" }
            : spend > 0
              ? { label: "Baixa leitura", tone: "danger" }
              : { label: "Sem gasto", tone: "neutral" };

        return {
          ...snapshot,
          name: compactCampaignName(snapshot.campaign_name),
          spend,
          clicks,
          impressions,
          leads,
          ctr,
          cpc,
          health,
          spendWidth: barWidth(spend, maxSpend),
          clickWidth: barWidth(clicks, maxClicks)
        };
      })
      .sort((a, b) => b.spend - a.spend);
  }, [overview.snapshots]);

  const activeCampaignRows = useMemo(() => {
    const active = campaignRows.filter((campaign) => isActiveMetaStatus(campaign.status));
    return active.length ? active : campaignRows;
  }, [campaignRows]);

  const dailySeries = useMemo(() => {
    return overview.dailySeries.map((item) => ({
      ...item,
      spend: numberValue(item.spend),
      impressions: numberValue(item.impressions),
      clicks: numberValue(item.clicks),
      leads: numberValue(item.leads),
      qualifiedLeads: numberValue(item.qualifiedLeads),
      proposals: numberValue(item.proposals),
      purchases: numberValue(item.purchases),
      ctr: numberValue(item.ctr),
      cpc: numberValue(item.cpc)
    }));
  }, [overview.dailySeries]);

  const upcomingMeetings = useMemo(() => {
    const now = Date.now();
    return overview.meetings
      .filter((meeting) => new Date(meeting.startsAt).getTime() >= now - 60 * 60 * 1000)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [overview.meetings]);

  const meetingDays = useMemo(() => {
    const grouped = new Map<string, TrafficMeeting[]>();
    for (const meeting of upcomingMeetings) {
      const key = dayKey(meeting.startsAt);
      grouped.set(key, [...(grouped.get(key) ?? []), meeting]);
    }
    return Array.from(grouped.entries()).slice(0, 10).map(([date, meetings]) => ({ date, meetings }));
  }, [upcomingMeetings]);

  const sellerMeetingStats = useMemo(() => {
    const grouped = new Map<string, { sellerName: string; total: number; career: number; international: number; ambos: number }>();
    for (const meeting of upcomingMeetings) {
      const sellerName = meeting.sellerName || "Sem vendedor";
      const current = grouped.get(sellerName) ?? { sellerName, total: 0, career: 0, international: 0, ambos: 0 };
      current.total += 1;
      if (meeting.serviceInterest === "plano_internacional") current.international += 1;
      else if (meeting.serviceInterest === "ambos") current.ambos += 1;
      else current.career += 1;
      grouped.set(sellerName, current);
    }
    return Array.from(grouped.values()).sort((a, b) => b.total - a.total);
  }, [upcomingMeetings]);

  const serviceMix = useMemo(() => {
    const total = Math.max(1, overview.metrics.totalLeads);
    return [
      { label: "Plano carreira", value: overview.metrics.careerLeads, tone: "cyan", width: barWidth(overview.metrics.careerLeads, total) },
      { label: "Internacional", value: overview.metrics.internationalLeads, tone: "violet", width: barWidth(overview.metrics.internationalLeads, total) },
      { label: "Quentes", value: overview.metrics.hotLeads, tone: "amber", width: barWidth(overview.metrics.hotLeads, total) },
      { label: "Fechados", value: overview.metrics.closed, tone: "green", width: barWidth(overview.metrics.closed, total) }
    ];
  }, [overview.metrics]);

  const attributionCards = useMemo(() => {
    const health = overview.attributionHealth;
    return [
      { label: "Leads do site", value: health.siteLeads, detail: `${health.attributionRate}% atribuidos`, tone: health.attributionRate >= 70 ? "green" : "amber" },
      { label: "fbp/fbc/fbclid", value: health.fbpLeads + health.fbcLeads + health.fbclidLeads, detail: "sinais de navegador", tone: "cyan" },
      { label: "Agendamentos", value: health.meetingEvents, detail: `${health.scheduleEvents} sinais Schedule`, tone: "violet" },
      { label: "Purchase CRM", value: health.purchaseEvents, detail: health.purchaseSignalGap ? `${health.purchaseSignalGap} pendente` : "sem gap", tone: health.purchaseSignalGap ? "amber" : "green" }
    ];
  }, [overview.attributionHealth]);

  const trafficReadinessScore = useMemo(() => {
    const metaPoints = metaStatus?.readyForInsights ? 25 : 0;
    const pixelPoints = metaStatus?.readyForQualityEvents ? 25 : 0;
    const campaignPoints = activeCampaignRows.length ? 20 : 0;
    const attributionPoints = normalizePercent(overview.attributionHealth.attributionRate, 20);
    const schedulePoints = upcomingMeetings.length ? 10 : 0;
    return Math.round(metaPoints + pixelPoints + campaignPoints + attributionPoints + schedulePoints);
  }, [activeCampaignRows.length, metaStatus?.readyForInsights, metaStatus?.readyForQualityEvents, overview.attributionHealth.attributionRate, upcomingMeetings.length]);

  const creativeRows = useMemo(() => {
    const adRows = (overview.adPerformance ?? []).map((item) => {
      const spend = numberValue(item.spend);
      const clicks = numberValue(item.clicks);
      const impressions = numberValue(item.impressions);
      const leads = numberValue(item.leads);
      const qualifiedLeads = numberValue(item.qualifiedLeads);
      const purchases = numberValue(item.purchases);
      const conversions = leads + qualifiedLeads + purchases;
      const groupId = item.adsetId || item.campaignId || "sem-conjunto";
      return {
        id: item.adId || `${groupId}-${item.adName ?? "sem-anuncio"}`,
        name: compactCampaignName(item.adName || item.campaignName),
        groupId,
        groupName: compactCampaignName(item.adsetName || item.campaignName),
        campaignName: compactCampaignName(item.campaignName),
        status: item.status,
        spend,
        impressions,
        clicks,
        conversions,
        leads,
        qualifiedLeads,
        purchases,
        ctr: numberValue(item.ctr),
        cpc: numberValue(item.cpc),
        source: "ad" as const
      };
    });

    const fallbackRows = activeCampaignRows.map((campaign) => {
      const conversions = campaign.leads + numberValue(campaign.qualified_leads) + numberValue(campaign.purchases);
      return {
        id: campaign.campaign_id || campaign.name,
        name: campaign.name,
        groupId: campaign.campaign_id || campaign.name,
        groupName: campaign.name,
        campaignName: campaign.name,
        status: campaign.status,
        spend: campaign.spend,
        impressions: campaign.impressions,
        clicks: campaign.clicks,
        conversions,
        leads: campaign.leads,
        qualifiedLeads: numberValue(campaign.qualified_leads),
        purchases: numberValue(campaign.purchases),
        ctr: campaign.ctr,
        cpc: campaign.cpc,
        source: "campaign" as const
      };
    });

    return (adRows.length ? adRows : fallbackRows)
      .sort((a, b) => (b.conversions - a.conversions) || (b.clicks - a.clicks) || (b.spend - a.spend))
      .slice(0, 12);
  }, [activeCampaignRows, overview.adPerformance]);

  const budgetSegments = useMemo(() => {
    const grouped = new Map<string, {
      id: string;
      name: string;
      spend: number;
      clicks: number;
      conversions: number;
      metric: number;
    }>();

    for (const row of creativeRows) {
      const current = grouped.get(row.groupId) ?? {
        id: row.groupId,
        name: row.groupName,
        spend: 0,
        clicks: 0,
        conversions: 0,
        metric: 0
      };
      current.spend += row.spend;
      current.clicks += row.clicks;
      current.conversions += row.conversions;
      current.metric += row.spend || row.clicks || row.conversions || 1;
      grouped.set(row.groupId, current);
    }

    const rows = Array.from(grouped.values()).sort((a, b) => b.metric - a.metric).slice(0, 6);
    const totalMetric = Math.max(1, rows.reduce((sum, item) => sum + item.metric, 0));
    return rows.map((item, index) => ({
      ...item,
      color: trafficPalette[index % trafficPalette.length],
      percent: (item.metric / totalMetric) * 100
    }));
  }, [creativeRows]);

  const budgetDonutGradient = useMemo(() => {
    if (!budgetSegments.length) return "conic-gradient(rgba(91, 255, 219, 0.28), rgba(85, 216, 255, 0.12))";
    let cursor = 0;
    return `conic-gradient(${budgetSegments.map((segment) => {
      const start = cursor;
      cursor += segment.percent;
      return `${segment.color} ${start}% ${cursor}%`;
    }).join(", ")})`;
  }, [budgetSegments]);

  const selectedCreativeRows = useMemo(() => {
    if (!selectedBudgetSegment) return creativeRows;
    const rows = creativeRows.filter((row) => row.groupId === selectedBudgetSegment);
    return rows.length ? rows : creativeRows;
  }, [creativeRows, selectedBudgetSegment]);

  const leadPageTrend = useMemo(() => {
    const points = dailySeries.slice(-7);
    const maxClicks = Math.max(1, ...points.map((item) => item.clicks));
    const maxLeads = Math.max(1, ...points.map((item) => item.leads + item.qualifiedLeads + item.purchases));
    return points.map((point) => {
      const conversions = point.leads + point.qualifiedLeads + point.purchases;
      return {
        ...point,
        label: formatShortDate(point.date),
        conversions,
        clicksHeight: barWidth(point.clicks, maxClicks),
        leadsHeight: barWidth(conversions, maxLeads)
      };
    });
  }, [dailySeries]);

  const selectedAgendaDate = selectedMeetingDate ?? meetingDays[0]?.date ?? localDayKey(new Date());

  const agendaSellerOptions = useMemo(() => {
    const names = new Set(upcomingMeetings.map((meeting) => meeting.sellerName || "Sem vendedor"));
    return ["Todos", ...Array.from(names).sort((a, b) => a.localeCompare(b, "pt-BR"))];
  }, [upcomingMeetings]);

  const agendaCalendar = useMemo(() => {
    const baseDate = parseDateKey(selectedAgendaDate) ?? new Date();
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const meetingCountByDay = new Map<string, number>();
    for (const meeting of upcomingMeetings) {
      const key = dayKey(meeting.startsAt);
      meetingCountByDay.set(key, (meetingCountByDay.get(key) ?? 0) + 1);
    }

    const cells: Array<{ key: string; date?: string; day?: number; count?: number; isToday?: boolean; empty?: boolean }> = [];
    for (let index = 0; index < firstDay.getDay(); index += 1) {
      cells.push({ key: `empty-${index}`, empty: true });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = localDayKey(new Date(year, month, day));
      cells.push({
        key,
        date: key,
        day,
        count: meetingCountByDay.get(key) ?? 0,
        isToday: key === localDayKey(new Date())
      });
    }
    return { title: monthTitle(selectedAgendaDate), cells };
  }, [selectedAgendaDate, upcomingMeetings]);

  const filteredAgendaMeetings = useMemo(() => {
    return upcomingMeetings.filter((meeting) => {
      const sameDay = dayKey(meeting.startsAt) === selectedAgendaDate;
      const sameSeller = selectedSellerFilter === "Todos" || (meeting.sellerName || "Sem vendedor") === selectedSellerFilter;
      return sameDay && sameSeller;
    });
  }, [selectedAgendaDate, selectedSellerFilter, upcomingMeetings]);

  const leadPageConversionRate = mediaSummary.clicks
    ? ((overview.attributionHealth.siteLeads || mediaSummary.leads) / mediaSummary.clicks) * 100
    : 0;
  const costPerSiteLead = overview.attributionHealth.siteLeads
    ? mediaSummary.spend / overview.attributionHealth.siteLeads
    : mediaSummary.leads
      ? mediaSummary.spend / mediaSummary.leads
      : 0;

  const topCampaign = campaignRows[0];
  const mainBottleneck = segments.reduce((best, item) => (item.value > best.value ? item : best), segments[0] ?? { title: "Sem dados", value: 0 });
  const maxCreativeImpact = Math.max(1, ...selectedCreativeRows.map((row) => row.conversions || row.clicks || row.spend));
  const quickRead = mediaSummary.campaigns
    ? `Gargalo principal: ${mainBottleneck.title} (${mainBottleneck.value}). Campanha em destaque: ${shortText(topCampaign?.name ?? "sem dados")}.`
    : "Sincronize a Meta para ver campanhas, custos e cliques neste painel.";

  async function loadOverview() {
    const requestId = overviewRequestRef.current + 1;
    overviewRequestRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const data = await apiJson<TrafficOverview>("/api/traffic?action=overview&days=30");
      if (requestId !== overviewRequestRef.current) return;
      setOverview({
        ...emptyOverview,
        ...data,
        metrics: { ...emptyOverview.metrics, ...data.metrics },
        eventCounts: data.eventCounts ?? [],
        ageGroups: data.ageGroups ?? [],
        recentEvents: data.recentEvents ?? [],
        recommendations: data.recommendations ?? [],
        drafts: data.drafts ?? [],
        snapshots: data.snapshots ?? [],
        adPerformance: data.adPerformance ?? [],
        dailySeries: data.dailySeries ?? [],
        meetings: data.meetings ?? [],
        attributionHealth: { ...emptyOverview.attributionHealth, ...(data.attributionHealth ?? {}) }
      });
    } catch (err) {
      if (requestId === overviewRequestRef.current) {
        setError(err instanceof Error ? err.message : "Falha ao carregar trafego.");
      }
    } finally {
      if (requestId === overviewRequestRef.current) {
        setLoading(false);
      }
    }
  }

  async function generateRecommendations(provider: "local" | "base44" = "local") {
    setActionLoading(true);
    setError(null);
    setNotice(null);
    try {
      const data = await apiJson<{ recommendations: TrafficRecommendation[]; usedAgent: boolean; provider: string }>("/api/traffic?action=recommendations", {
        method: "POST",
        body: JSON.stringify({ periodDays: 30, provider })
      });
      setOverview((current) => ({
        ...current,
        recommendations: [...(data.recommendations ?? []), ...current.recommendations].slice(0, 20)
      }));
      setNotice(data.usedAgent ? "IA Base44 analisou o funil e salvou recomendacoes." : "IA local do CRM classificou trafego e funil.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao gerar recomendacoes.");
    } finally {
      setActionLoading(false);
    }
  }

  async function exportTrafficData() {
    setError(null);
    try {
      const response = await fetch("/api/traffic?action=export&days=180", { cache: "no-store", credentials: "include" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Falha ao exportar dados.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ec10-traffic-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("Exportacao gerada com dados de trafego, funil, rascunhos e campanhas.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao exportar dados.");
    }
  }

  async function syncMeta() {
    setActionLoading(true);
    setError(null);
    setNotice(null);
    try {
      const data = await apiJson<{ rows: number; since: string; until: string }>("/api/traffic?action=meta-sync", {
        method: "POST",
        body: JSON.stringify({ days: 30 })
      });
      setNotice(`Meta sincronizado: ${data.rows} linhas de ${data.since} ate ${data.until}.`);
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao sincronizar Meta.");
    } finally {
      setActionLoading(false);
    }
  }

  async function loadMetaStatus() {
    if (!isAdmin) return;
    const requestId = metaStatusRequestRef.current + 1;
    metaStatusRequestRef.current = requestId;
    setMetaLoading(true);
    setError(null);
    try {
      const data = await apiJson<MetaStatus>("/api/traffic?action=meta-status");
      if (requestId !== metaStatusRequestRef.current) return;
      setMetaStatus(data);
    } catch (err) {
      if (requestId === metaStatusRequestRef.current) {
        setError(err instanceof Error ? err.message : "Falha ao verificar Meta.");
      }
    } finally {
      if (requestId === metaStatusRequestRef.current) {
        setMetaLoading(false);
      }
    }
  }

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionLoading(true);
    setError(null);
    setNotice(null);
    try {
      const data = await apiJson<{ draft: TrafficCampaignDraft }>("/api/traffic?action=draft", {
        method: "POST",
        body: JSON.stringify({
          serviceInterest,
          ageGroup,
          region,
          budgetDaily: budgetDaily ? Number(budgetDaily) : null,
          budgetTotal: budgetTotal ? Number(budgetTotal) : null,
          goal
        })
      });
      setOverview((current) => ({ ...current, drafts: [data.draft, ...current.drafts].slice(0, 20) }));
      setNotice("Rascunho de campanha criado sem publicar no Meta.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar rascunho.");
    } finally {
      setActionLoading(false);
    }
  }

  async function updateDraftStatus(draftId: string, status: "pending_approval" | "approved" | "rejected") {
    setActionLoading(true);
    setError(null);
    try {
      const data = await apiJson<{ draft: TrafficCampaignDraft }>("/api/traffic?action=draft", {
        method: "PATCH",
        body: JSON.stringify({ id: draftId, status })
      });
      setOverview((current) => ({
        ...current,
        drafts: current.drafts.map((draft) => (draft.id === draftId ? data.draft : draft))
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atualizar rascunho.");
    } finally {
      setActionLoading(false);
    }
  }

  async function publishDraft(draftId: string) {
    setActionLoading(true);
    setError(null);
    setNotice(null);
    try {
      const data = await apiJson<{ draft: TrafficCampaignDraft }>("/api/traffic?action=publish-draft", {
        method: "POST",
        body: JSON.stringify({ id: draftId })
      });
      setOverview((current) => ({
        ...current,
        drafts: current.drafts.map((draft) => (draft.id === draftId ? data.draft : draft))
      }));
      setNotice("Campanha publicada no Meta em PAUSED. Revise no Gerenciador antes de ativar gasto.");
    } catch (err) {
      await loadOverview();
      setError(err instanceof Error ? err.message : "Falha ao publicar no Meta.");
    } finally {
      setActionLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    void (async () => {
      await loadOverview();
      if (active && isAdmin) await loadMetaStatus();
    })();

    return () => {
      active = false;
    };
  }, [isAdmin]);

  return (
    <section className="traffic-panel">
      {isAdmin ? <BhPrimeManager /> : null}
      <div className="traffic-toolbar">
        <div>
          <h2>Gestao de trafego IA</h2>
          <span>Ultimos {overview.periodDays} dias</span>
        </div>
        <div className="traffic-actions">
          <button className="icon-command" type="button" onClick={loadOverview} title="Atualizar">
            <RefreshCw size={18} className={loading ? "spin" : ""} />
          </button>
          {isAdmin ? (
            <>
              <button className="primary-action secondary" type="button" onClick={syncMeta} disabled={actionLoading}>
                <BarChart3 size={18} /> Meta
              </button>
              <button className="primary-action secondary" type="button" onClick={loadMetaStatus} disabled={metaLoading}>
                <RefreshCw size={18} className={metaLoading ? "spin" : ""} /> Status
              </button>
              <button className="primary-action secondary" type="button" onClick={exportTrafficData} disabled={actionLoading}>
                <Download size={18} /> Exportar
              </button>
              <button className="primary-action secondary" type="button" onClick={() => generateRecommendations("base44")} disabled={actionLoading}>
                <Sparkles size={18} /> Base44
              </button>
              <button className="primary-action" type="button" onClick={() => generateRecommendations("local")} disabled={actionLoading}>
                <Sparkles size={18} /> Analisar
              </button>
            </>
          ) : null}
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="notice-banner">{notice}</div> : null}

      <section className="traffic-hero">
        <div className="traffic-hero-copy">
          <span>Leitura rapida</span>
          <strong>{quickRead}</strong>
        </div>
        <div className="traffic-kpi-strip">
          <TrafficMetric icon={<BarChart3 size={18} />} label="Investimento" value={formatMoney(mediaSummary.spend)} />
          <TrafficMetric icon={<TrendingUp size={18} />} label="Cliques" value={formatCompact(mediaSummary.clicks)} />
          <TrafficMetric icon={<Target size={18} />} label="CPC medio" value={formatMoney(mediaSummary.cpc)} />
          <TrafficMetric icon={<Flame size={18} />} label="CTR" value={formatPercent(mediaSummary.ctr)} />
        </div>
      </section>

      <div className="traffic-metrics">
        <TrafficMetric icon={<UsersRound size={18} />} label="Leads WhatsApp" value={String(overview.metrics.whatsappLeads)} />
        <TrafficMetric icon={<Flame size={18} />} label="Quentes" value={String(overview.metrics.hotLeads)} detail={`${overview.metrics.hotRate}%`} />
        <TrafficMetric icon={<Target size={18} />} label="Orcamentos" value={String(overview.metrics.proposals)} />
        <TrafficMetric icon={<CheckCircle2 size={18} />} label="Fechados" value={String(overview.metrics.closed)} detail={`${overview.metrics.conversionRate}%`} />
        <TrafficMetric icon={<BarChart3 size={18} />} label="Score medio" value={String(Math.round(overview.metrics.averageScore))} />
      </div>

      <section className="traffic-command-center">
        <div className="command-score">
          <Gauge size={22} />
          <span>Prontidao operacional</span>
          <strong>{trafficReadinessScore}%</strong>
          <small>Meta, pixel, CAPI, campanha e agenda</small>
        </div>
        <div className="command-grid">
          <TrafficMetric icon={<Radio size={18} />} label="Campanhas ativas" value={String(activeCampaignRows.length)} detail={`${campaignRows.length} sincronizadas`} />
          <TrafficMetric icon={<Activity size={18} />} label="Sinais qualidade" value={String(overview.attributionHealth.qualifiedEvents + overview.attributionHealth.scheduleEvents + overview.attributionHealth.purchaseEvents)} detail="CRM -> Meta" />
          <TrafficMetric icon={<CalendarDays size={18} />} label="Reunioes futuras" value={String(upcomingMeetings.length)} detail={`${sellerMeetingStats.length} vendedores`} />
          <TrafficMetric icon={<Link2 size={18} />} label="Atribuicao site" value={formatPercent(overview.attributionHealth.attributionRate)} detail={`${overview.attributionHealth.attributedLeads}/${overview.attributionHealth.siteLeads}`} />
        </div>
      </section>

      <div className="traffic-deep-title">
        <div>
          <h2><BarChart3 size={24} /> Analise profunda de campanhas</h2>
          <span>Orcamento, criativos, lead page, CRM e agenda em uma leitura unica.</span>
        </div>
        <span className="traffic-live-pill"><Activity size={14} /> Live data</span>
      </div>

      <div className="traffic-deep-grid">
        <section className="traffic-section neon-card budget-lab-card">
          <div className="section-heading">
            <div>
              <h2>Orcamento por conjunto</h2>
              <span>Clique para filtrar os criativos daquele grupo.</span>
            </div>
            <small>{creativeRows[0]?.source === "ad" ? "Nivel anuncio" : "Nivel campanha"}</small>
          </div>

          <div className="budget-donut-wrap">
            <button
              className="budget-donut"
              type="button"
              onClick={() => setSelectedBudgetSegment(null)}
              style={{ background: budgetDonutGradient }}
              title="Limpar filtro de conjunto"
            >
              <span>
                <strong>
                  {selectedBudgetSegment
                    ? `${Math.round(budgetSegments.find((segment) => segment.id === selectedBudgetSegment)?.percent ?? 100)}%`
                    : "100%"}
                </strong>
                <small>{selectedBudgetSegment ? "Selecionado" : "Distribuido"}</small>
              </span>
            </button>
          </div>

          <div className="budget-segment-list">
            {budgetSegments.map((segment) => (
              <button
                className={`budget-segment ${selectedBudgetSegment === segment.id ? "selected" : ""}`}
                type="button"
                key={segment.id}
                onClick={() => setSelectedBudgetSegment(selectedBudgetSegment === segment.id ? null : segment.id)}
              >
                <i style={{ backgroundColor: segment.color, boxShadow: `0 0 12px ${segment.color}` }} />
                <span>{shortText(segment.name, 32)}</span>
                <strong>{formatMoney(segment.spend)}</strong>
                <small>{Math.round(segment.percent)}% | {formatCompact(segment.clicks)} cliques</small>
              </button>
            ))}
            {!budgetSegments.length ? <p className="empty-state">Sincronize a Meta para calcular distribuicao de orcamento.</p> : null}
          </div>
        </section>

        <section className="traffic-section neon-card creative-rank-card">
          <div className="section-heading">
            <div>
              <h2>Ranking de criativos</h2>
              <span>{selectedBudgetSegment ? "Filtro aplicado por conjunto" : "Classificados por conversao, clique e gasto."}</span>
            </div>
            {selectedBudgetSegment ? (
              <button className="ghost-action" type="button" onClick={() => setSelectedBudgetSegment(null)}>
                <X size={14} /> Limpar
              </button>
            ) : (
              <MousePointerClick size={18} />
            )}
          </div>

          <div className="creative-rank-list">
            {selectedCreativeRows.map((row, index) => {
              const impact = row.conversions || row.clicks || row.spend;
              return (
                <article className="creative-rank-row" key={row.id}>
                  <div className={`creative-rank-number ${index < 3 ? "top" : ""}`}>#{index + 1}</div>
                  <div className="creative-rank-main">
                    <div>
                      <strong>{shortText(row.name, 70)}</strong>
                      <span>{shortText(row.groupName, 76)}</span>
                    </div>
                    <div className="creative-metrics">
                      <small>CTR {formatPercent(row.ctr)}</small>
                      <small>CPC {formatMoney(row.cpc)}</small>
                      <small>Gasto {formatMoney(row.spend)}</small>
                    </div>
                    <div className="creative-impact-track">
                      <i style={{ width: barWidth(impact, maxCreativeImpact) }} />
                    </div>
                  </div>
                  <div className="creative-rank-result">
                    <span>{isActiveMetaStatus(row.status) ? "Ativo" : row.status || "Lido"}</span>
                    <strong>{formatCompact(row.conversions)}</strong>
                    <small>conversoes</small>
                  </div>
                </article>
              );
            })}
            {!selectedCreativeRows.length ? (
              <div className="creative-empty-state">
                <PieChartIcon size={42} />
                <strong>Sem criativos individuais ainda</strong>
                <span>Sincronize a Meta para puxar anuncios, conjuntos e leitura de criativo.</span>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <div className="traffic-bottom-premium">
        <section className="traffic-section neon-card agenda-compact-card">
          <div
            className="agenda-open-card"
            role="button"
            tabIndex={0}
            onClick={() => setShowAgendaModal(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") setShowAgendaModal(true);
            }}
          >
            <div className="section-heading">
              <div>
                <h2><UsersRound size={18} /> CRM & Agenda</h2>
                <span>Vendedores, servicos e reunioes futuras.</span>
              </div>
              <CalendarDays size={20} />
            </div>

            <div className="seller-mini-grid">
              {sellerMeetingStats.slice(0, 4).map((seller) => (
                <article className="seller-mini-card" key={seller.sellerName}>
                  <UserCheck size={18} />
                  <strong>{seller.sellerName}</strong>
                  <span>{seller.total} reunioes</span>
                  <small>Carreira {seller.career} | Inter {seller.international}</small>
                </article>
              ))}
              {!sellerMeetingStats.length ? <p className="empty-state">Nenhum vendedor com reuniao futura.</p> : null}
            </div>

            <span className="agenda-open-cta">Abrir gestao completa <ChevronRight size={16} /></span>
          </div>
        </section>

        <section className="traffic-section neon-card leadpage-card">
          <div className="section-heading">
            <div>
              <h2>Performance Lead Page</h2>
              <span>Cliques Meta, leads do site e atribuicao por pixel/CAPI.</span>
            </div>
            <Link2 size={18} />
          </div>

          <div className="leadpage-bars">
            {leadPageTrend.map((point) => (
              <div className="leadpage-day" key={point.date}>
                <div>
                  <span className="clicks" style={{ height: point.clicksHeight }} title={`${point.clicks} cliques`} />
                  <span className="leads" style={{ height: point.leadsHeight }} title={`${point.conversions} leads`} />
                </div>
                <small>{point.label}</small>
              </div>
            ))}
            {!leadPageTrend.length ? <p className="empty-state">Sem serie diaria sincronizada para a lead page.</p> : null}
          </div>

          <div className="leadpage-legend">
            <span><i className="clicks" /> Cliques</span>
            <span><i className="leads" /> Leads / qualidade</span>
          </div>

          <div className="leadpage-stat-grid">
            <article>
              <span>Taxa lead page</span>
              <strong>{formatPercent(leadPageConversionRate)}</strong>
              <small>{formatCompact(overview.attributionHealth.siteLeads || mediaSummary.leads)} leads do site</small>
            </article>
            <article>
              <span>Custo por lead</span>
              <strong>{formatMoney(costPerSiteLead)}</strong>
              <small>{formatMoney(mediaSummary.spend)} investidos</small>
            </article>
            <article>
              <span>Atribuicao</span>
              <strong>{formatPercent(overview.attributionHealth.attributionRate)}</strong>
              <small>{overview.attributionHealth.attributedLeads}/{overview.attributionHealth.siteLeads} com sinal</small>
            </article>
          </div>

          <div className="service-focus-strip">
            {serviceMix.map((item) => (
              <div className={`service-mix-row ${item.tone}`} key={item.label}>
                <span>{item.label}</span>
                <div className="service-mix-track">
                  <i style={{ width: item.width }} />
                </div>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>

      {showAgendaModal ? (
        <div className="traffic-agenda-modal" role="dialog" aria-modal="true" aria-label="Gestao de Agenda e CRM">
          <div className="agenda-modal-panel">
            <header className="agenda-modal-header">
              <div>
                <CalendarDays size={24} />
                <div>
                  <h2>Gestao de Agenda & CRM</h2>
                  <span>Calendario consolidado por vendedor e servico.</span>
                </div>
              </div>
              <button type="button" onClick={() => setShowAgendaModal(false)} title="Fechar agenda">
                <X size={22} />
              </button>
            </header>

            <div className="agenda-modal-body">
              <aside className="agenda-calendar-panel">
                <div className="agenda-month-head">
                  <button type="button" title="Mes anterior"><ChevronLeft size={16} /></button>
                  <strong>{agendaCalendar.title}</strong>
                  <button type="button" title="Proximo mes"><ChevronRight size={16} /></button>
                </div>

                <div className="agenda-weekdays">
                  {["D", "S", "T", "Q", "Q", "S", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
                </div>
                <div className="agenda-calendar-grid">
                  {agendaCalendar.cells.map((cell) => (
                    cell.empty ? (
                      <span className="agenda-day-empty" key={cell.key} />
                    ) : (
                      <button
                        className={`agenda-day-button ${selectedAgendaDate === cell.date ? "selected" : ""} ${cell.isToday ? "today" : ""}`}
                        type="button"
                        key={cell.key}
                        onClick={() => cell.date && setSelectedMeetingDate(cell.date)}
                      >
                        <span>{cell.day}</span>
                        {cell.count ? <small>{cell.count}</small> : null}
                      </button>
                    )
                  ))}
                </div>

                <div className="agenda-seller-filter">
                  <h3>Filtrar vendedor</h3>
                  {agendaSellerOptions.map((seller) => (
                    <button
                      className={selectedSellerFilter === seller ? "selected" : ""}
                      type="button"
                      key={seller}
                      onClick={() => setSelectedSellerFilter(seller)}
                    >
                      <span>{seller}</span>
                      <small>{seller === "Todos" ? upcomingMeetings.length : upcomingMeetings.filter((meeting) => (meeting.sellerName || "Sem vendedor") === seller).length}</small>
                    </button>
                  ))}
                </div>
              </aside>

              <section className="agenda-list-panel">
                <div className="agenda-list-head">
                  <div>
                    <h3>Reunioes marcadas</h3>
                    <span>{formatDateKeyWeekday(selectedAgendaDate)} {formatDateKeyShort(selectedAgendaDate)} | {selectedSellerFilter}</span>
                  </div>
                  <strong>{filteredAgendaMeetings.length}</strong>
                </div>

                <div className="agenda-meeting-list">
                  {filteredAgendaMeetings.map((meeting) => (
                    <article className="agenda-meeting-row" key={`${meeting.clientId}-${meeting.startsAt}`}>
                      <div className="priority-edge" />
                      <div className="agenda-avatar">
                        {String(meeting.clientName || "L").slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <strong>{meeting.clientName || "Lead sem nome"}</strong>
                        <span>{serviceLabel[meeting.serviceInterest ?? "nao_definido"] ?? meeting.serviceInterest ?? "Servico nao definido"}</span>
                        <small>{meeting.sellerName || "Sem vendedor"} | {leadStatusLabel[meeting.status ?? ""] ?? meeting.status ?? "sem status"}</small>
                      </div>
                      <div className="agenda-time-pill">
                        <Clock3 size={15} />
                        <strong>{formatMeetingTime(meeting.startsAt)}</strong>
                        {meeting.meetUrl ? <a href={meeting.meetUrl} target="_blank" rel="noreferrer">Meet</a> : null}
                      </div>
                    </article>
                  ))}
                  {!filteredAgendaMeetings.length ? (
                    <div className="agenda-empty-state">
                      <CalendarDays size={42} />
                      <strong>Nenhuma reuniao neste filtro</strong>
                      <span>Escolha outra data ou vendedor para visualizar a agenda.</span>
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {isAdmin && metaStatus ? (
        <section className={`traffic-section meta-status-card ${metaStatus.readyForInsights ? "ready" : "blocked"}`}>
          <div className="section-heading">
            <h2>Conexao Meta</h2>
            <span>{metaStatus.graphVersion}</span>
          </div>
          <div className="meta-checks">
            <MetaCheck label="Token" ok={Boolean(metaStatus.checks.find((item) => item.name === "token")?.ok)} />
            <MetaCheck label="Conta de anuncios" ok={Boolean(metaStatus.checks.find((item) => item.name === "ad_account")?.ok)} />
            <MetaCheck label="Insights" ok={metaStatus.readyForInsights} />
            <MetaCheck label="Landing Pixel" ok={Boolean(metaStatus.checks.find((item) => item.name === "landing_pixel")?.ok)} />
            <MetaCheck label="Pixel/CAPI" ok={metaStatus.readyForQualityEvents} />
          </div>
          {metaStatus.requiredActions.length ? (
            <div className="meta-actions-needed">
              {metaStatus.requiredActions.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          ) : (
            <p className="empty-state compact">Meta pronto para leitura de campanhas e sinais de qualidade.</p>
          )}
        </section>
      ) : null}

      <div className="traffic-layout">
        <section className="traffic-section">
          <div className="section-heading">
            <h2>Orquestracao do funil</h2>
            <span>Da conversa ao fechamento</span>
          </div>
          <div className="funnel-chart">
            {funnelSteps.map((step) => (
              <div className={`funnel-row ${step.tone}`} key={step.label}>
                <div className="funnel-label">
                  <span>{step.label}</span>
                  <strong>{step.value}</strong>
                </div>
                <div className="funnel-track">
                  <div className="funnel-fill" style={{ "--bar": step.width } as CSSProperties} />
                </div>
              </div>
            ))}
          </div>

          <div className="traffic-segments">
            {segments.map((segment) => (
              <article className={`traffic-segment ${segment.tone}`} key={segment.title}>
                <span>{segment.title}</span>
                <strong>{segment.value}</strong>
              </article>
            ))}
          </div>

          <div className="traffic-events">
            <h2>Sinais do funil</h2>
            {overview.eventCounts.slice(0, 10).map((item) => (
              <div className="traffic-event-row" key={item.eventType}>
                <span>{eventLabel[item.eventType] ?? item.eventType}</span>
                <strong>{item.total}</strong>
              </div>
            ))}
            {!overview.eventCounts.length ? <p className="empty-state">Nenhum evento de trafego registrado ainda.</p> : null}
          </div>
        </section>

        <section className="traffic-section">
          <div className="section-heading">
            <h2>Prioridades da equipe</h2>
            <span>{overview.recommendations.length}</span>
          </div>
          <div className="recommendation-list">
            {overview.recommendations.slice(0, 6).map((item) => (
              <article className={`recommendation ${item.priority}`} key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.summary}</span>
                </div>
                <div className="recommendation-meta">
                  <small>{priorityLabel(item.priority)}</small>
                  <small>{item.confidence}%</small>
                  {item.age_group ? <small>{item.age_group}</small> : null}
                </div>
                {item.reasoning ? <p className="recommendation-text">{item.reasoning}</p> : null}
              </article>
            ))}
            {!overview.recommendations.length ? <p className="empty-state">Sem recomendacoes salvas.</p> : null}
          </div>
        </section>
      </div>

      <div className="traffic-layout">
        <section className="traffic-section">
          <div className="section-heading">
            <h2>Rascunho de campanha</h2>
            <span>Meta Ads</span>
          </div>
          {isAdmin ? (
            <form className="draft-form" onSubmit={createDraft}>
              <label>
                Servico
                <select value={serviceInterest} onChange={(event) => setServiceInterest(event.target.value as ServiceInterest)}>
                  <option value="plano_carreira">Plano de carreira</option>
                  <option value="plano_internacional">Plano internacional</option>
                  <option value="ambos">Ambos</option>
                </select>
              </label>
              <label>
                Faixa do atleta
                <select value={ageGroup} onChange={(event) => setAgeGroup(event.target.value)}>
                  <option value="8-17">8 a 17</option>
                  <option value="8-12">8 a 12</option>
                  <option value="13-17">13 a 17</option>
                  <option value="8-13">8 a 13</option>
                  <option value="14-17">14 a 17</option>
                  <option value="18-plus">18+</option>
                </select>
              </label>
              <label>
                Regiao
                <input value={region} onChange={(event) => setRegion(event.target.value)} />
              </label>
              <label>
                Diario
                <input type="number" min="1" step="1" value={budgetDaily} onChange={(event) => setBudgetDaily(event.target.value)} />
              </label>
              <label>
                Total
                <input type="number" min="1" step="1" value={budgetTotal} onChange={(event) => setBudgetTotal(event.target.value)} placeholder="Opcional" />
              </label>
              <label className="draft-goal">
                Objetivo fino
                <input value={goal} onChange={(event) => setGoal(event.target.value)} />
              </label>
              <button type="submit" disabled={actionLoading}>
                <Megaphone size={18} /> Criar rascunho
              </button>
            </form>
          ) : (
            <p className="empty-state">Somente administradores criam rascunhos de trafego.</p>
          )}
        </section>

        <section className="traffic-section">
          <div className="section-heading">
            <h2>Campanhas e rascunhos</h2>
            <span>{overview.drafts.length}</span>
          </div>
          <div className="draft-list">
            {overview.drafts.map((draft) => (
              <article className="draft-item" key={draft.id}>
                <div>
                  <strong>{draft.name}</strong>
                  <span>{serviceLabel[draft.service_interest] ?? draft.service_interest} - {draft.status}</span>
                </div>
                <div className="draft-budget">
                  <small>Diario {formatMoney(draft.budget_daily)}</small>
                  <small>Total {formatMoney(draft.budget_total)}</small>
                </div>
                {draft.copy_text ? <p>{draft.copy_text}</p> : null}
                <div className="draft-tags">
                  {draft.locations?.slice(0, 2).map((item) => <small key={item}>{item}</small>)}
                  {draft.interests?.slice(0, 4).map((item) => <small key={item}>{item}</small>)}
                  {draft.meta_campaign_id ? <small>Meta {draft.meta_campaign_id}</small> : null}
                </div>
                {draft.publish_error ? <p className="draft-error">{draft.publish_error}</p> : null}
                {isAdmin ? (
                  <div className="draft-actions">
                    <button type="button" onClick={() => updateDraftStatus(draft.id, "pending_approval")} disabled={actionLoading}>
                      <Send size={16} /> Revisar
                    </button>
                    <button type="button" onClick={() => updateDraftStatus(draft.id, "approved")} disabled={actionLoading}>
                      <CheckCircle2 size={16} /> Aprovar
                    </button>
                    <button type="button" onClick={() => updateDraftStatus(draft.id, "rejected")} disabled={actionLoading}>
                      <AlertTriangle size={16} /> Rejeitar
                    </button>
                    {draft.status === "approved" || draft.status === "failed" ? (
                      <button type="button" onClick={() => publishDraft(draft.id)} disabled={actionLoading}>
                        <Rocket size={16} /> Publicar pausada
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
            {!overview.drafts.length ? <p className="empty-state">Sem rascunhos criados.</p> : null}
          </div>
        </section>
      </div>

      <section className="traffic-section campaign-visual-section">
        <div className="section-heading">
          <h2>Campanhas ativas Meta</h2>
          <span>{activeCampaignRows.length} ativas / {campaignRows.length} sincronizadas</span>
        </div>
        <div className="campaign-board">
          {activeCampaignRows.map((campaign) => (
            <div className="campaign-card" key={`${campaign.campaign_id ?? campaign.name}`}>
              <div className="campaign-card-head">
                <strong>{campaign.name}</strong>
                <span className={`campaign-health ${campaign.health.tone}`}>{isActiveMetaStatus(campaign.status) ? "Ativa" : campaign.health.label}</span>
              </div>
              <div className="campaign-bars">
                <div className="campaign-bar">
                  <span>Gasto</span>
                  <div className="campaign-track">
                    <div className="campaign-fill spend" style={{ "--bar": campaign.spendWidth } as CSSProperties} />
                  </div>
                  <strong>{formatMoney(campaign.spend)}</strong>
                </div>
                <div className="campaign-bar">
                  <span>Cliques</span>
                  <div className="campaign-track">
                    <div className="campaign-fill clicks" style={{ "--bar": campaign.clickWidth } as CSSProperties} />
                  </div>
                  <strong>{formatCompact(campaign.clicks)}</strong>
                </div>
              </div>
              <div className="campaign-metrics">
                <small>{formatCompact(campaign.impressions)} impressoes</small>
                <small>{formatPercent(campaign.ctr)} CTR</small>
                <small>{formatMoney(campaign.cpc)} CPC</small>
                <small>{campaign.leads} leads</small>
                <small>{numberValue(campaign.qualified_leads)} qualificados</small>
                <small>{numberValue(campaign.purchases)} compras</small>
              </div>
            </div>
          ))}
          {!activeCampaignRows.length ? <p className="empty-state">Sem campanhas ativas sincronizadas. Clique em Meta para importar os dados.</p> : null}
        </div>
      </section>

      <section className="traffic-section recent-section">
        <div className="section-heading">
          <h2>Sinais recentes</h2>
          <span>{overview.recentEvents.length}</span>
        </div>
        <div className="recent-events">
          {overview.recentEvents.slice(0, 12).map((event) => (
            <div className="recent-event" key={event.id}>
              <TrendingUp size={16} />
              <span>{eventLabel[event.event_type] ?? event.event_type}</span>
              <small>{event.age_group ?? "sem faixa"} - {event.phone ?? "sem telefone"} - {formatDate(event.occurred_at)}</small>
            </div>
          ))}
          {!overview.recentEvents.length ? <p className="empty-state">Sem sinais recentes.</p> : null}
        </div>
      </section>
    </section>
  );
}

function TrafficMetric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail?: string }) {
  return (
    <div className="traffic-metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function MetaCheck({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={`meta-check ${ok ? "ok" : "blocked"}`}>
      {ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
      <span>{label}</span>
    </div>
  );
}

function priorityLabel(priority: TrafficRecommendation["priority"]) {
  if (priority === "urgent") return "Urgente";
  if (priority === "high") return "Alta";
  if (priority === "low") return "Baixa";
  return "Media";
}
