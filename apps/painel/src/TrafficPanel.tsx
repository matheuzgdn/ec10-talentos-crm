import { FormEvent, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Download,
  Flame,
  Megaphone,
  RefreshCw,
  Rocket,
  Send,
  Sparkles,
  Target,
  TrendingUp,
  UsersRound
} from "lucide-react";
import type { ServiceInterest } from "@crm/shared";

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
  snapshots: []
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
  seller_reply_sent: "Vendedor respondeu",
  qualified_lead: "Lead quente",
  proposal_requested: "Orcamento",
  purchase: "Fechamento",
  lost_lead: "Perdido"
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

  const topCampaign = campaignRows[0];
  const mainBottleneck = segments.reduce((best, item) => (item.value > best.value ? item : best), segments[0] ?? { title: "Sem dados", value: 0 });
  const quickRead = mediaSummary.campaigns
    ? `Gargalo principal: ${mainBottleneck.title} (${mainBottleneck.value}). Campanha com mais investimento: ${shortText(topCampaign?.name ?? "sem dados")}.`
    : "Sincronize a Meta para ver campanhas, custos e cliques neste painel.";

  async function loadOverview() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiJson<TrafficOverview>("/api/traffic?action=overview&days=30");
      setOverview({
        ...emptyOverview,
        ...data,
        metrics: { ...emptyOverview.metrics, ...data.metrics },
        eventCounts: data.eventCounts ?? [],
        ageGroups: data.ageGroups ?? [],
        recentEvents: data.recentEvents ?? [],
        recommendations: data.recommendations ?? [],
        drafts: data.drafts ?? [],
        snapshots: data.snapshots ?? []
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar trafego.");
    } finally {
      setLoading(false);
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
    setMetaLoading(true);
    setError(null);
    try {
      const data = await apiJson<MetaStatus>("/api/traffic?action=meta-status");
      setMetaStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao verificar Meta.");
    } finally {
      setMetaLoading(false);
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
          <h2>Campanhas Meta</h2>
          <span>{campaignRows.length} em leitura</span>
        </div>
        <div className="campaign-board">
          {campaignRows.map((campaign) => (
            <div className="campaign-card" key={`${campaign.campaign_id ?? campaign.name}`}>
              <div className="campaign-card-head">
                <strong>{campaign.name}</strong>
                <span className={`campaign-health ${campaign.health.tone}`}>{campaign.health.label}</span>
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
              </div>
            </div>
          ))}
          {!campaignRows.length ? <p className="empty-state">Sem campanhas sincronizadas. Clique em Meta para importar os dados.</p> : null}
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
