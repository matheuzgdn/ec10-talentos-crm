import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  ClipboardCheck,
  Dumbbell,
  Globe2,
  Loader2,
  MessageCircle,
  ShieldCheck,
  Trophy,
  UsersRound,
  Video,
  WalletCards
} from "lucide-react";

type LeadRole = "responsavel" | "atleta" | "";

type FormState = {
  leadName: string;
  role: LeadRole;
  phone: string;
  athleteName: string;
  athleteAge: string;
  guardianName: string;
  guardianPhone: string;
  city: string;
  position: string;
  currentClub: string;
  trainingLevel: string;
  objective: string;
  investmentRange: string;
  readiness: string;
  videoLink: string;
  noVideoMaterial: boolean;
  consent: boolean;
  website: string;
};

type SubmitResult = {
  ok: true;
  clientId?: string;
  whatsappUrl?: string;
  queuedMessages?: number;
};

type TrackingWindow = Window & {
  fbq?: (...args: unknown[]) => void;
  _fbq?: (...args: unknown[]) => void;
  dataLayer?: Array<Record<string, unknown>>;
  __ec10MetaPixelInitialized?: boolean;
};

const META_PIXEL_ID = "834310425674029";
const FORM_VARIANT = "career_plan_registration_2026_06";
const DEFAULT_WHATSAPP_URL = "https://wa.me/553198526146";
const brandMark = "https://static.wixstatic.com/media/933cdd_c2bda993bb1e4abfab5d73a3e419f495~mv2.png";
const heroMedia = "https://video.wixstatic.com/video/933cdd_eb14b07c4db843ac878f02fed62bb4c6/720p/mp4/file.mp4";
const mentorImage = "https://static.wixstatic.com/media/933cdd_935b59f989b64c2aa3e721fd2a3ce15e~mv2.png/v1/fill/w_480,h_600,al_c,q_85,enc_auto/933cdd_935b59f989b64c2aa3e721fd2a3ce15e~mv2.png";
const supportImage = "https://static.wixstatic.com/media/933cdd_d2b3680f343c4f139ee7387948611868~mv2.jpg/v1/fill/w_840,h_520,al_c,q_85,enc_auto/933cdd_d2b3680f343c4f139ee7387948611868~mv2.jpg";

const initialForm: FormState = {
  leadName: "",
  role: "",
  phone: "",
  athleteName: "",
  athleteAge: "",
  guardianName: "",
  guardianPhone: "",
  city: "",
  position: "",
  currentClub: "",
  trainingLevel: "",
  objective: "",
  investmentRange: "",
  readiness: "",
  videoLink: "",
  noVideoMaterial: false,
  consent: false,
  website: ""
};

const benefits = [
  {
    icon: <UsersRound size={20} />,
    title: "Mentorias com ex-jogadores",
    text: "Direcao de carreira para pais e atletas com leitura de quem viveu futebol profissional."
  },
  {
    icon: <Dumbbell size={20} />,
    title: "Treinos fisicos personalizados",
    text: "Plano de evolucao individual para o momento do atleta, idade, rotina e objetivo."
  },
  {
    icon: <Video size={20} />,
    title: "Marketing completo",
    text: "Flyers de jogo, edicao de video e organizacao da imagem para avaliacoes e oportunidades."
  },
  {
    icon: <ClipboardCheck size={20} />,
    title: "Analise tecnica e tatica",
    text: "Leitura dos jogos para entender pontos fortes, corrigir lacunas e orientar o proximo passo."
  },
  {
    icon: <Trophy size={20} />,
    title: "Testes em clubes",
    text: "Direcionamento para avaliacoes no Brasil e possibilidades internacionais quando fizer sentido."
  },
  {
    icon: <Globe2 size={20} />,
    title: "Rede EC10 de jogadores e clubes",
    text: "Acesso ao ecossistema onde o atleta pode ganhar visibilidade para parceiros e empresarios."
  }
];

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function getTrackingWindow() {
  return window as unknown as TrackingWindow;
}

function getCookie(name: string) {
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) ?? "";
}

function currentTraffic() {
  const params = new URLSearchParams(window.location.search);
  const fbclid = params.get("fbclid") ?? "";
  const fbc = getCookie("_fbc") || (fbclid ? `fb.1.${Date.now()}.${fbclid}` : "");
  return {
    utmSource: params.get("utm_source") ?? "",
    utmMedium: params.get("utm_medium") ?? "",
    utmCampaign: params.get("utm_campaign") ?? "",
    utmContent: params.get("utm_content") ?? "",
    utmTerm: params.get("utm_term") ?? "",
    fbclid,
    gclid: params.get("gclid") ?? "",
    fbp: getCookie("_fbp"),
    fbc,
    sourcePath: window.location.pathname,
    landingVariant: FORM_VARIANT
  };
}

function ensureTracking() {
  const trackingWindow = getTrackingWindow();
  trackingWindow.dataLayer = trackingWindow.dataLayer ?? [];

  if (!trackingWindow.fbq) {
    const fbqQueue: unknown[] = [];
    const fbq = ((...args: unknown[]) => {
      fbqQueue.push(args);
    }) as ((...args: unknown[]) => void) & { queue: unknown[] };
    fbq.queue = fbqQueue;
    trackingWindow.fbq = fbq as unknown as TrackingWindow["fbq"];
    trackingWindow._fbq = trackingWindow.fbq;
    const script = document.createElement("script");
    script.id = "ec10-meta-pixel";
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(script);
  }

  if (!trackingWindow.__ec10MetaPixelInitialized) {
    trackingWindow.fbq?.("init", META_PIXEL_ID);
    trackingWindow.__ec10MetaPixelInitialized = true;
  }
}

function track(eventName: string, payload: Record<string, unknown> = {}, metaEvent?: string, eventId?: string) {
  ensureTracking();
  const trackingWindow = getTrackingWindow();
  const data = {
    ...currentTraffic(),
    bot_niche: "plano_carreira",
    service_interest: "plano_carreira",
    form_name: "career_plan_registration",
    ...payload
  };

  trackingWindow.dataLayer?.push({ event: eventName, ...data });
  trackingWindow.fbq?.("trackCustom", eventName, data);
  if (metaEvent) trackingWindow.fbq?.("track", metaEvent, data, eventId ? { eventID: eventId } : undefined);
}

function leadScore(form: FormState) {
  const age = Number(form.athleteAge);
  let score = 42;

  if (age >= 9 && age <= 23) score += 14;
  if (age >= 13 && age <= 19) score += 8;
  if (!form.noVideoMaterial && form.videoLink.trim()) score += 8;
  if (form.currentClub.trim()) score += 7;
  if (form.trainingLevel === "competitivo" || form.trainingLevel === "federado") score += 8;
  if (form.readiness === "agora") score += 9;
  if (form.readiness === "30_dias") score += 5;
  if (form.investmentRange === "300_600") score += 6;
  if (form.investmentRange === "600_1000") score += 10;
  if (form.investmentRange === "1000_plus") score += 14;
  if (form.objective.length > 40) score += 4;

  return Math.max(0, Math.min(100, score));
}

function profileTemperature(score: number) {
  if (score >= 82) return "Lead quente";
  if (score >= 68) return "Bom potencial";
  if (score >= 54) return "Em analise";
  return "Precisa triagem";
}

function investmentLabel(value: string) {
  return {
    ate_300: "Ate R$ 300 por mes",
    "300_600": "R$ 300 a R$ 600 por mes",
    "600_1000": "R$ 600 a R$ 1.000 por mes",
    "1000_plus": "Acima de R$ 1.000 por mes",
    indefinido: "Ainda preciso entender o plano"
  }[value] ?? "";
}

export function CareerPlanSignupPage() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [submitError, setSubmitError] = useState("");
  const startedAt = useRef(Date.now());
  const score = useMemo(() => leadScore(form), [form]);
  const temperature = profileTemperature(score);
  const athleteAge = Number(form.athleteAge);
  const athleteIsMinor = Number.isFinite(athleteAge) && athleteAge < 18;
  const needsGuardian = form.role === "atleta" && athleteIsMinor;

  useEffect(() => {
    document.title = "Cadastro Plano de Carreira EC10 | Ficha do Atleta";
    const metaDescription = document.querySelector('meta[name="description"]') ?? document.createElement("meta");
    metaDescription.setAttribute("name", "description");
    metaDescription.setAttribute("content", "Ficha rapida para pais e atletas entenderem se o atleta esta apto ao Plano de Carreira EC10.");
    document.head.appendChild(metaDescription);

    ensureTracking();
    track("career_registration_viewed", { page_path: window.location.pathname }, "PageView");
    track("public_landing_viewed", { landing_variant: FORM_VARIANT }, "ViewContent");
  }, []);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
    setSubmitError("");
  }

  function updateNoVideoMaterial(checked: boolean) {
    setForm((current) => ({
      ...current,
      noVideoMaterial: checked,
      videoLink: checked ? "" : current.videoLink
    }));
    setSubmitError("");
  }

  function validate() {
    const nextErrors: Record<string, string> = {};
    const age = Number(form.athleteAge);

    if (form.leadName.trim().split(/\s+/).filter(Boolean).length < 2) nextErrors.leadName = "Informe nome e sobrenome.";
    if (!form.role) nextErrors.role = "Escolha se voce e responsavel ou atleta.";
    if (digitsOnly(form.phone).length < 10) nextErrors.phone = "Informe um WhatsApp valido com DDD.";
    if (form.athleteName.trim().length < 2) nextErrors.athleteName = "Informe o nome do atleta.";
    if (!Number.isInteger(age) || age < 6 || age > 40) nextErrors.athleteAge = "Informe idade entre 6 e 40 anos.";
    if (form.city.trim().length < 2) nextErrors.city = "Informe cidade e estado.";
    if (!form.trainingLevel) nextErrors.trainingLevel = "Escolha o nivel atual.";
    if (form.objective.trim().length < 8) nextErrors.objective = "Conte rapidamente o objetivo do atleta.";
    if (!form.investmentRange) nextErrors.investmentRange = "Escolha uma faixa de investimento.";
    if (!form.readiness) nextErrors.readiness = "Escolha quando pretende comecar.";
    if (needsGuardian) {
      if (form.guardianName.trim().length < 2) nextErrors.guardianName = "Atleta menor precisa informar o responsavel.";
      if (digitsOnly(form.guardianPhone).length < 10) nextErrors.guardianPhone = "Informe o WhatsApp do responsavel.";
    }
    if (!form.consent) nextErrors.consent = "Confirme o envio da ficha para a equipe EC10.";

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate()) {
      track("career_registration_validation_error", { score, temperature });
      return;
    }

    setSubmitting(true);
    setSubmitError("");

    try {
      const response = await fetch("/api/create-client?public=site-bot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.leadName.trim(),
          phone: form.phone,
          countryDialCode: "55",
          role: form.role,
          botNiche: "plano_carreira",
          interest: "Plano de Carreira EC10 - ficha completa",
          serviceInterest: "plano_carreira",
          athleteName: form.athleteName.trim(),
          athleteAge: Number(form.athleteAge),
          guardianName: form.guardianName.trim(),
          guardianPhone: form.guardianPhone.trim(),
          city: form.city.trim(),
          position: form.position.trim(),
          currentClub: form.currentClub.trim(),
          trainingLevel: form.trainingLevel,
          objective: form.objective.trim(),
          investmentRange: form.investmentRange,
          investmentLabel: investmentLabel(form.investmentRange),
          readiness: form.readiness,
          videoLink: form.noVideoMaterial ? "" : form.videoLink.trim(),
          noVideoMaterial: form.noVideoMaterial,
          videoMaterialStatus: form.noVideoMaterial
            ? "sem_material"
            : (form.videoLink.trim() ? "link_informado" : "nao_informado"),
          qualificationScore: score,
          qualificationTemperature: temperature,
          startedAt: startedAt.current,
          website: form.website,
          ...currentTraffic()
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error ?? "Nao foi possivel enviar a ficha.");

      const eventId = data?.clientId ? `site-${data.clientId}-${FORM_VARIANT}-lead` : undefined;
      track("lead_submitted_public", { score, temperature, role: form.role }, "Lead", eventId);
      track("lead_created_public", { score, temperature, role: form.role }, "CompleteRegistration");
      setResult(data as SubmitResult);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Nao foi possivel enviar a ficha.");
      track("lead_submit_error_public", { score, temperature, role: form.role });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="career-signup-page">
      <section className="career-hero" id="topo">
        <video className="career-hero-media" src={heroMedia} autoPlay muted loop playsInline />
        <div className="career-hero-overlay" />
        <nav className="career-nav" aria-label="Navegacao principal">
          <a href="#topo" aria-label="EC10 Talentos">
            <img src={brandMark} alt="EC10 Talentos" />
          </a>
          <div>
            <a href="#plano">Plano</a>
            <a href="#ficha">Ficha</a>
            <a href="#suporte">Suporte</a>
          </div>
        </nav>

        <div className="career-hero-content">
          <span className="career-kicker">Cadastro oficial EC10</span>
          <h1>Cadastro Plano de Carreira EC10</h1>
          <p>
            Preencha a ficha rapida para a equipe entender o momento do atleta, medir o perfil
            de investimento da familia e indicar se ele esta apto para iniciar o plano de carreira.
          </p>
          <div className="career-hero-actions">
            <a href="#ficha" className="career-primary-button">
              Iniciar ficha <ArrowRight size={18} />
            </a>
            <a href="#plano" className="career-secondary-button">Entender o plano</a>
          </div>
          <div className="career-trust-strip" aria-label="Diferenciais do plano">
            <span><BadgeCheck size={16} /> Mentoria</span>
            <span><Video size={16} /> Marketing</span>
            <span><Globe2 size={16} /> Clubes parceiros</span>
          </div>
        </div>
      </section>

      <section className="career-section career-plan-band" id="plano">
        <div className="career-section-head">
          <span>O que e o Plano de Carreira</span>
          <h2>Um caminho acompanhado para o atleta nao depender de tentativa isolada.</h2>
          <p>
            A EC10 organiza mentoria, rotina, imagem, analise e oportunidades para pais e atletas
            tomarem decisoes com direcao desde cedo, inclusive quando o tempo ja passou e a familia
            precisa corrigir rota.
          </p>
        </div>
        <div className="career-benefit-grid">
          {benefits.map((benefit) => (
            <article className="career-benefit-card" key={benefit.title}>
              {benefit.icon}
              <h3>{benefit.title}</h3>
              <p>{benefit.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="career-section career-proof-band" id="suporte">
        <div className="career-proof-copy">
          <span>Suporte para a decisao</span>
          <h2>A familia recebe orientacao antes de investir no sonho.</h2>
          <p>
            A ficha abaixo nao e so cadastro. Ela mede temperatura, urgencia, perfil do atleta e
            capacidade de investimento para a equipe tratar cada lead com o suporte certo.
          </p>
          <div className="career-proof-list">
            <span><ShieldCheck size={18} /> Triagem para atleta e responsavel</span>
            <span><WalletCards size={18} /> Leitura de investimento mensal</span>
            <span><MessageCircle size={18} /> Continuidade pelo WhatsApp EC10</span>
          </div>
        </div>
        <div className="career-mentor-frame">
          <img src={mentorImage} alt="Eric Cena, fundador EC10" />
          <div>
            <strong>Direcao de carreira EC10</strong>
            <span>Mentoria, avaliacao e caminho esportivo para pais e atletas.</span>
          </div>
        </div>
      </section>

      <section className="career-section career-form-section" id="ficha">
        <div className="career-form-intro">
          <h2>Teste avaliativo EC10</h2>
          <p>
            Responda uma etapa por vez. A equipe avalia o perfil do atleta e chama pelo WhatsApp.
          </p>
          <img src={supportImage} alt="Equipe e atletas EC10" />
        </div>

        <form className="career-form" onSubmit={submit} noValidate>
          <input
            type="text"
            className="career-honeypot"
            tabIndex={-1}
            autoComplete="off"
            value={form.website}
            onChange={(event) => updateField("website", event.target.value)}
          />

          <div className="career-form-grid two">
            <Field label="Seu nome completo" error={errors.leadName}>
              <input value={form.leadName} onChange={(event) => updateField("leadName", event.target.value)} autoComplete="name" placeholder="Nome e sobrenome" />
            </Field>
            <Field label="Seu WhatsApp" error={errors.phone}>
              <input value={form.phone} onChange={(event) => updateField("phone", event.target.value)} inputMode="tel" autoComplete="tel" placeholder="(31) 99999-9999" />
            </Field>
          </div>

          <fieldset className="career-choice-field">
            <legend>Voce esta preenchendo como:</legend>
            <div>
              <button type="button" className={form.role === "responsavel" ? "selected" : ""} onClick={() => updateField("role", "responsavel")}>
                Responsavel pelo atleta
              </button>
              <button type="button" className={form.role === "atleta" ? "selected" : ""} onClick={() => updateField("role", "atleta")}>
                Atleta
              </button>
            </div>
            {errors.role ? <small>{errors.role}</small> : null}
          </fieldset>

          <div className="career-form-grid two">
            <Field label="Nome do atleta" error={errors.athleteName}>
              <input value={form.athleteName} onChange={(event) => updateField("athleteName", event.target.value)} placeholder="Nome do atleta" />
            </Field>
            <Field label="Idade do atleta" error={errors.athleteAge}>
              <input value={form.athleteAge} onChange={(event) => updateField("athleteAge", digitsOnly(event.target.value).slice(0, 2))} inputMode="numeric" placeholder="15" />
            </Field>
          </div>

          {needsGuardian ? (
            <div className="career-guardian-box">
              <strong>Atleta menor de idade</strong>
              <p>Para continuar, precisamos do nome e WhatsApp do responsavel.</p>
              <div className="career-form-grid two">
                <Field label="Nome do responsavel" error={errors.guardianName}>
                  <input value={form.guardianName} onChange={(event) => updateField("guardianName", event.target.value)} placeholder="Nome do responsavel" />
                </Field>
                <Field label="WhatsApp do responsavel" error={errors.guardianPhone}>
                  <input value={form.guardianPhone} onChange={(event) => updateField("guardianPhone", event.target.value)} inputMode="tel" placeholder="(31) 99999-9999" />
                </Field>
              </div>
            </div>
          ) : null}

          <div className="career-form-grid two">
            <Field label="Cidade/estado ou pais" error={errors.city}>
              <input value={form.city} onChange={(event) => updateField("city", event.target.value)} placeholder="Belo Horizonte - MG" />
            </Field>
            <Field label="Posicao principal">
              <input value={form.position} onChange={(event) => updateField("position", event.target.value)} placeholder="Meia, lateral, goleiro..." />
            </Field>
          </div>

          <div className="career-form-grid two">
            <Field label="Clube/escola atual">
              <input value={form.currentClub} onChange={(event) => updateField("currentClub", event.target.value)} placeholder="Clube, escolinha ou sem clube" />
            </Field>
            <Field label="Nivel atual" error={errors.trainingLevel}>
              <select value={form.trainingLevel} onChange={(event) => updateField("trainingLevel", event.target.value)}>
                <option value="">Escolha</option>
                <option value="iniciante">Iniciante / escolinha</option>
                <option value="competitivo">Competitivo regional</option>
                <option value="federado">Federado ou clube</option>
                <option value="profissional">Profissional ou transicao</option>
              </select>
            </Field>
          </div>

          <Field label="Objetivo principal do atleta" error={errors.objective}>
            <textarea value={form.objective} onChange={(event) => updateField("objective", event.target.value)} placeholder="Ex: entrar em clube, melhorar desempenho, buscar avaliacao, jogar fora do Brasil..." />
          </Field>

          <div className="career-form-grid two">
            <Field label="Quanto a familia esta disposta a investir?" error={errors.investmentRange}>
              <select value={form.investmentRange} onChange={(event) => updateField("investmentRange", event.target.value)}>
                <option value="">Escolha uma faixa</option>
                <option value="ate_300">Ate R$ 300 por mes</option>
                <option value="300_600">R$ 300 a R$ 600 por mes</option>
                <option value="600_1000">R$ 600 a R$ 1.000 por mes</option>
                <option value="1000_plus">Acima de R$ 1.000 por mes</option>
                <option value="indefinido">Preciso entender antes</option>
              </select>
            </Field>
            <Field label="Quando quer comecar?" error={errors.readiness}>
              <select value={form.readiness} onChange={(event) => updateField("readiness", event.target.value)}>
                <option value="">Escolha</option>
                <option value="agora">Agora, quero atendimento hoje</option>
                <option value="30_dias">Nos proximos 30 dias</option>
                <option value="avaliando">Estou avaliando possibilidades</option>
              </select>
            </Field>
          </div>

          <div className="career-field">
            <span>Link de video ou rede social do atleta</span>
            <input
              value={form.videoLink}
              onChange={(event) => updateField("videoLink", event.target.value)}
              placeholder="Instagram, YouTube, Drive, Hudl..."
              disabled={form.noVideoMaterial}
            />
            <label className="career-inline-check">
              <input
                type="checkbox"
                checked={form.noVideoMaterial}
                onChange={(event) => updateNoVideoMaterial(event.target.checked)}
              />
              <span>Nao tenho material de video</span>
            </label>
          </div>

          <label className="career-consent">
            <input type="checkbox" checked={form.consent} onChange={(event) => updateField("consent", event.target.checked)} />
            <span>Autorizo a EC10 a analisar esta ficha e continuar o atendimento pelo WhatsApp.</span>
          </label>
          {errors.consent ? <small className="career-error">{errors.consent}</small> : null}

          <button className="career-submit-button" type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="spin" size={18} /> : <CheckCircle2 size={18} />}
            {submitting ? "Enviando ficha..." : "Enviar ficha e ativar atendimento"}
          </button>

          {submitError ? (
            <div className="career-submit-error" role="alert">
              <strong>Nao conseguimos concluir automaticamente.</strong>
              <span>{submitError}</span>
              <a href={DEFAULT_WHATSAPP_URL} target="_blank" rel="noreferrer" onClick={() => track("lead_fallback_whatsapp_clicked_public", { score, temperature }, "Contact")}>
                Continuar pelo WhatsApp
              </a>
            </div>
          ) : null}

          {result ? (
            <div className="career-submit-success" role="status">
              <CheckCircle2 size={22} />
              <strong>Ficha enviada com sucesso.</strong>
              <span>A equipe EC10 recebeu os dados e o atendimento pelo WhatsApp foi ativado.</span>
              <a href={result.whatsappUrl || DEFAULT_WHATSAPP_URL} target="_blank" rel="noreferrer" onClick={() => track("lead_success_whatsapp_clicked", { score, temperature }, "Contact")}>
                Abrir WhatsApp
              </a>
            </div>
          ) : null}
        </form>
      </section>
    </main>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="career-field">
      <span>{label}</span>
      {children}
      {error ? <small>{error}</small> : null}
    </label>
  );
}
