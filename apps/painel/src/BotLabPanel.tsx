import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Bot,
  CheckCircle2,
  FlaskConical,
  Pencil,
  RefreshCw,
  Send,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  User,
  Volume2
} from "lucide-react";

type LabSession = {
  id: string;
  name: string;
  current_stage: string;
  athlete_age: number | null;
  speaker_role: "responsavel" | "atleta" | "outro";
  service_interest: string | null;
  status: string;
  updated_at: string;
};

type LabMessage = {
  id: string;
  direction: "user" | "assistant";
  body: string;
  stage: string;
  audio_paths: string[];
  would_schedule: boolean;
  created_at: string;
};

type LabStats = { approved: number; corrected: number; rejected: number };
type ReviewState = Record<string, "approved" | "corrected" | "rejected">;

async function labApi<T>(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...options, headers, credentials: "include", cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Falha no laboratorio.");
  }
  return response.json() as Promise<T>;
}

const stageLabels: Record<string, string> = {
  opening: "Abertura natural",
  awaiting_context: "Entendendo o contato",
  awaiting_role: "Atleta ou responsável",
  awaiting_company_familiarity: "Conhecimento da EC10",
  awaiting_age: "Idade",
  awaiting_interest: "Conversa e qualificação",
  awaiting_guardian_confirmation: "Participação do responsável",
  awaiting_meeting_date: "Data",
  awaiting_meeting_time: "Horario",
  completed: "Concluido"
};

function audioLabel(path: string) {
  const name = path.split("/").at(-1) || path;
  return name.replace(/^\d+_/, "").replace(/\.ogg$/i, "").replace(/-/g, " ");
}

export function BotLabPanel() {
  const [sessions, setSessions] = useState<LabSession[]>([]);
  const [session, setSession] = useState<LabSession | null>(null);
  const [messages, setMessages] = useState<LabMessage[]>([]);
  const [stats, setStats] = useState<LabStats>({ approved: 0, corrected: 0, rejected: 0 });
  const [age, setAge] = useState("");
  const [role, setRole] = useState<LabSession["speaker_role"]>("outro");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviews, setReviews] = useState<ReviewState>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [correction, setCorrection] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeAudios = useMemo(
    () => [...messages].reverse().find((item) => item.audio_paths?.length)?.audio_paths ?? [],
    [messages]
  );

  async function load(sessionId?: string) {
    setError(null);
    const query = sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : "";
    const data = await labApi<{ sessions: LabSession[]; sessionId: string | null; messages: LabMessage[]; stats: LabStats }>(
      `/api/bot-status?lab=1&action=state${query}`
    );
    setSessions(data.sessions ?? []);
    const selected = data.sessions.find((item) => item.id === data.sessionId) ?? data.sessions[0] ?? null;
    setSession(selected);
    setMessages(data.messages ?? []);
    setStats(data.stats ?? { approved: 0, corrected: 0, rejected: 0 });
    setAge(selected?.athlete_age ? String(selected.athlete_age) : "");
    setRole(selected?.speaker_role || "outro");
  }

  async function createSession() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await labApi<{ session: LabSession; messages: LabMessage[] }>("/api/bot-status?lab=1&action=session", {
        method: "POST",
        body: JSON.stringify({ athleteAge: Number(age) || null, speakerRole: role })
      });
      setSessions((current) => [data.session, ...current]);
      setSession(data.session);
      setMessages([]);
      setReviews({});
      setNotice("Nova conversa isolada criada. Comece como um cliente real.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar simulacao.");
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body || !session || busy) return;
    const optimistic: LabMessage = {
      id: `local-${Date.now()}`,
      direction: "user",
      body,
      stage: session.current_stage,
      audio_paths: [],
      would_schedule: false,
      created_at: new Date().toISOString()
    };
    setMessages((current) => [...current, optimistic]);
    setText("");
    setBusy(true);
    setError(null);
    try {
      const data = await labApi<{ message: LabMessage; session: LabSession }>("/api/bot-status?lab=1&action=message", {
        method: "POST",
        body: JSON.stringify({ sessionId: session.id, message: body, athleteAge: Number(age) || null, speakerRole: role })
      });
      setMessages((current) => [...current.filter((item) => item.id !== optimistic.id), optimistic, data.message]);
      setSession((current) => current ? { ...current, ...data.session } : data.session);
    } catch (err) {
      setMessages((current) => current.filter((item) => item.id !== optimistic.id));
      setText(body);
      setError(err instanceof Error ? err.message : "Falha ao simular mensagem.");
    } finally {
      setBusy(false);
    }
  }

  async function review(message: LabMessage, rating: "approved" | "corrected" | "rejected", correctedResponse?: string) {
    setBusy(true);
    setError(null);
    try {
      await labApi("/api/bot-status?lab=1&action=review", {
        method: "POST",
        body: JSON.stringify({ messageId: message.id, rating, correctedResponse })
      });
      setReviews((current) => ({ ...current, [message.id]: rating }));
      setStats((current) => ({
        ...current,
        [rating]: current[rating] + 1
      }));
      setEditingId(null);
      setCorrection("");
      setNotice(rating === "rejected" ? "Resposta rejeitada e registrada." : "Exemplo aprovado para as proximas simulacoes.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao avaliar resposta.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Falha ao abrir laboratorio."));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  return (
    <section className="bot-lab">
      <header className="bot-lab-header">
        <div>
          <span className="bot-lab-eyebrow"><FlaskConical size={15} /> Ambiente controlado</span>
          <h2>Laboratório do Anderson</h2>
        </div>
        <div className="bot-lab-safety"><ShieldCheck size={17} /> 0 envios reais · 0 leads · 0 reunioes</div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="notice-banner">{notice}</div> : null}

      <div className="bot-lab-layout">
        <aside className="bot-lab-settings">
          <div className="bot-lab-panel-title">
            <strong>Cenário opcional</strong>
            <button type="button" onClick={createSession} disabled={busy} title="Nova conversa"><RefreshCw size={16} /></button>
          </div>
          <label>
            Idade pré-definida
            <input type="number" min="1" max="99" value={age} onChange={(event) => setAge(event.target.value)} placeholder="Deixe vazio para a IA descobrir" />
          </label>
          <span className="bot-lab-field-label">Perfil pré-definido</span>
          <div className="bot-lab-role" role="group" aria-label="Quem esta falando">
            {(["responsavel", "atleta", "outro"] as const).map((item) => (
              <button className={role === item ? "active" : ""} type="button" key={item} onClick={() => setRole(item)}>
                {item === "responsavel" ? "Responsável" : item === "atleta" ? "Atleta" : "Descobrir na conversa"}
              </button>
            ))}
          </div>
          <div className="bot-lab-stage">
            <span>Etapa atual</span>
            <strong>{stageLabels[session?.current_stage || "opening"] || session?.current_stage}</strong>
          </div>
          <div className="bot-lab-sessions">
            <span className="bot-lab-field-label">Simulacoes recentes</span>
            {sessions.slice(0, 6).map((item) => (
              <button type="button" className={session?.id === item.id ? "active" : ""} key={item.id} onClick={() => void load(item.id)}>
                <span>{item.name}</span>
                <small>{item.athlete_age ? `${item.athlete_age} anos` : "sem idade"}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="bot-lab-chat">
          <div className="bot-lab-chat-head">
            <div className="bot-lab-avatar"><Bot size={18} /></div>
            <div><strong>Anderson · EC10</strong><span>Conversa isolada · estilo e conhecimento dos áudios do Eric</span></div>
          </div>
          <div className="bot-lab-messages" ref={scrollRef}>
            {!messages.length ? (
              <div className="bot-lab-empty">
                <FlaskConical size={28} />
                <strong>Converse como um cliente real</strong>
                <span>Comece, por exemplo, com “Boa tarde, tudo bem?”. O Anderson deve descobrir o contexto naturalmente.</span>
              </div>
            ) : null}
            {messages.map((message) => (
              <div className={`bot-lab-message ${message.direction}`} key={message.id}>
                <div className="bot-lab-message-icon">{message.direction === "assistant" ? <Bot size={15} /> : <User size={15} />}</div>
                <div>
                  <p>{message.body}</p>
                  {message.audio_paths?.length ? (
                    <div className="bot-lab-audio-note"><Volume2 size={14} /> {message.audio_paths.length} audio(s) seriam enviados</div>
                  ) : null}
                  {message.direction === "assistant" && !message.id.startsWith("local-") ? (
                    <div className="bot-lab-review">
                      <button className={reviews[message.id] === "approved" ? "selected" : ""} type="button" onClick={() => review(message, "approved")} disabled={busy} title="Aprovar resposta"><ThumbsUp size={14} /></button>
                      <button className={reviews[message.id] === "rejected" ? "selected rejected" : ""} type="button" onClick={() => review(message, "rejected")} disabled={busy} title="Rejeitar resposta"><ThumbsDown size={14} /></button>
                      <button type="button" onClick={() => { setEditingId(message.id); setCorrection(message.body); }} disabled={busy} title="Corrigir resposta"><Pencil size={14} /></button>
                      <span>{reviews[message.id] ? "avaliada" : "avaliar para aprendizado"}</span>
                    </div>
                  ) : null}
                  {editingId === message.id ? (
                    <form className="bot-lab-correction" onSubmit={(event) => { event.preventDefault(); void review(message, "corrected", correction); }}>
                      <textarea value={correction} onChange={(event) => setCorrection(event.target.value)} rows={3} />
                      <button type="submit" disabled={busy || !correction.trim()}><CheckCircle2 size={14} /> Salvar correcao</button>
                    </form>
                  ) : null}
                </div>
              </div>
            ))}
            {busy ? <div className="bot-lab-typing"><Bot size={15} /> analisando no ambiente isolado...</div> : null}
          </div>
          <form className="bot-lab-composer" onSubmit={sendMessage}>
            <input value={text} onChange={(event) => setText(event.target.value)} placeholder={session ? "Digite como se fosse o cliente..." : "Clique em nova conversa para começar"} disabled={!session || busy} />
            <button type="submit" disabled={!session || busy || !text.trim()} title="Enviar na simulacao"><Send size={18} /></button>
          </form>
        </section>

        <aside className="bot-lab-learning">
          <strong>Aprendizado aprovado</strong>
          <div className="bot-lab-stats">
            <div><span>Aprovadas</span><strong>{stats.approved}</strong></div>
            <div><span>Corrigidas</span><strong>{stats.corrected}</strong></div>
            <div><span>Rejeitadas</span><strong>{stats.rejected}</strong></div>
          </div>
          <div className="bot-lab-rule">
            <ShieldCheck size={17} />
            <p><strong>Regra fixa</strong>Menor de 18: agenda apenas com responsavel. A partir de 18: o atleta pode agendar.</p>
          </div>
          <div className="bot-lab-source">
            <span>Audios da rota atual</span>
            {activeAudios.length ? activeAudios.map((path) => (
              <div key={path}><Volume2 size={15} /><span>{audioLabel(path)}</span></div>
            )) : <small>Os áudios aparecem quando a idade e o caminho entram naturalmente na conversa.</small>}
          </div>
          <p className="bot-lab-note">Aprove, rejeite ou corrija cada resposta. Somente exemplos aprovados ou corrigidos ajudam as próximas simulações. Nada é enviado ao WhatsApp.</p>
        </aside>
      </div>
    </section>
  );
}
