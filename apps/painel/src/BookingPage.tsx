import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, LockKeyhole, Plus, RefreshCw, Trash2 } from "lucide-react";
import { crmApiUrl } from "./lib/crm-api";
import "./booking.css";

type Service = "plano_carreira" | "plano_internacional" | "eurocamp";
type Slot = { id: string; startsAt: string; endsAt: string; sellerName: string };
type SellerSlot = Slot & { sellerId: string; service: Service; bookingId: string | null; contactName: string | null; phone: string | null; videoUrl?: string | null; canManage: boolean };
type Booking = { id: string; startsAt: string; endsAt: string; sellerName: string; service: Service; programName?:string;accessToken: string; groupInviteUrl: string | null };

const labels: Record<Service, string> = {
  plano_carreira: "Plano de Carreira", plano_internacional: "Plano Internacional", eurocamp: "Eurocamp"
};

function readService(): Service {
  const value = new URLSearchParams(window.location.search).get("servico");
  return value === "plano_internacional" || value === "eurocamp" ? value : "plano_carreira";
}

function formatDate(value: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", ...options }).format(new Date(value));
}

function googleCalendarUrl(booking: Booking) {
  const stamp = (date: string) => new Date(date).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE", text: `EC10 | ${booking.programName||labels[booking.service]} | Reuniao com ${booking.sellerName}`,
    dates: `${stamp(booking.startsAt)}/${stamp(booking.endsAt)}`,
    details: "Reuniao comercial EC10. Os detalhes da chamada serao confirmados pelo WhatsApp."
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

async function apiJson(url: string, init?: RequestInit) {
  const response = await fetch(crmApiUrl(url), { credentials: "include", ...init });
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("A agenda esta temporariamente indisponivel. Tente novamente em instantes.");
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Nao foi possivel concluir. Tente novamente.");
  return result;
}

export function BookingPage() {
  const [service, setService] = useState<Service>(readService);
  const [sellerMode, setSellerMode] = useState(new URLSearchParams(window.location.search).get("modo") === "vendedor");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string>("");
  const [selectedDay,setSelectedDay]=useState('');
  const [athleteVideoUrl,setAthleteVideoUrl]=useState('');
  const [guardianConfirmed,setGuardianConfirmed]=useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [age, setAge] = useState("");
  const [role, setRole] = useState<"responsavel" | "atleta">("responsavel");
  const [seller, setSeller] = useState<{ name: string; role: string } | null>(null);
  const [canViewTeam, setCanViewTeam] = useState(false);
  const [sellerSlots, setSellerSlots] = useState<SellerSlot[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [prefillLoaded, setPrefillLoaded] = useState(false);
  const [registrationToken] = useState(new URLSearchParams(window.location.search).get("cadastro") || "");
  const [newTime, setNewTime] = useState("");
  const programLabel=booking?.programName||(service==='eurocamp'&&Number(age)>=8&&Number(age)<=13?'Eurokids / Sudakids':labels[service]);

  const refreshSlots = async (chosen: Service) => {
    setLoading(true);
    setError("");
    try {
      const result = await apiJson(`/api/booking?service=${chosen}${registrationToken&&!sellerMode?`&cadastro=${encodeURIComponent(registrationToken)}`:''}`);
      setSlots(result.slots ?? []);
      if(result.booking)setBooking(result.booking);
    } catch (cause) { setError((cause as Error).message); }
    finally { setLoading(false); }
  };

  const refreshSeller = async () => {
    try {
      const result = await apiJson("/api/booking?mode=seller");
      setSeller(result.seller);
      setCanViewTeam(result.canViewTeam === true);
      setSellerSlots(result.slots ?? []);
    } catch { setSeller(null); setCanViewTeam(false); }
  };

  useEffect(() => {
    document.title = "Agende sua reunião | EC10 Talentos";
    void refreshSlots(service); setSelectedSlot("");setSelectedDay('');
  }, [service]);
  useEffect(() => { if (sellerMode) void refreshSeller(); }, [sellerMode]);
  useEffect(() => {
    if (!registrationToken || sellerMode) return;
    let active = true;
    void apiJson(`/api/booking?mode=prefill&cadastro=${encodeURIComponent(registrationToken)}`)
      .then(({prefill,booking:saved}) => {
        if (!active) return;
        setName(prefill.name);setPhone(`+${prefill.phone}`);setContactEmail(prefill.email);
        setRole(prefill.athleteAge&&prefill.athleteAge<18?'responsavel':prefill.role);setAge(prefill.athleteAge ? String(prefill.athleteAge) : "");
        setService(prefill.service);setPrefillLoaded(true);
        setAthleteVideoUrl(prefill.videoUrl||'');
        if(saved)setBooking(saved);
      }).catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [registrationToken, sellerMode]);

  const days = useMemo(() => {
    const groups = new Map<string, Slot[]>();
    for (const slot of slots) {
      const key = formatDate(slot.startsAt, { weekday: "long", day: "2-digit", month: "long" });
      groups.set(key, [...(groups.get(key) ?? []), slot]);
    }
    return Array.from(groups.entries());
  }, [slots]);
  const chosenDay=days.find(([day])=>day===selectedDay);
  const chosenSlot=slots.find(slot=>slot.id===selectedSlot);

  const reserve = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    if (!selectedSlot) return setError("Escolha um horario antes de confirmar.");
    if (Number(age) < 18 && role !== "responsavel") return setError("Para menores de 18 anos, o responsavel deve marcar a reuniao.");
    setSaving(true);
    try {
      const result = await apiJson("/api/booking", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reserve", service, slotId: selectedSlot, contactName: name,
          contactRole: role, athleteAge: Number(age), phone, registrationToken, contactEmail,athleteVideoUrl,
          guardianConfirmed:Number(age)>=18||guardianConfirmed }) });
      setBooking(result.booking);
    } catch (cause) { await refreshSlots(service); setError((cause as Error).message); }
    finally { setSaving(false); }
  };

  const login = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await apiJson("/api/booking", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "seller_login", email, password }) });
      await refreshSeller();
    } catch (cause) { setError((cause as Error).message); }
    finally { setSaving(false); }
  };

  const openTime = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await apiJson("/api/booking", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "open_slot", service, startsAt: new Date(newTime).toISOString() }) });
      setNewTime(""); await refreshSeller(); await refreshSlots(service);
    } catch (cause) { setError((cause as Error).message); }
    finally { setSaving(false); }
  };

  const deleteTime = async (id: string) => {
    setError("");
    try { await apiJson(`/api/booking?id=${encodeURIComponent(id)}`, { method: "DELETE" }); await refreshSeller(); await refreshSlots(service); }
    catch (cause) { setError((cause as Error).message); }
  };

  const switchService = (next: Service) => {
    if (registrationToken && !sellerMode) return;
    setService(next);
    const url = new URL(window.location.href); url.searchParams.set("servico", next);
    window.history.replaceState({}, "", url);
  };

  const switchMode = () => {
    setSellerMode(!sellerMode); setError("");
    const url = new URL(window.location.href);
    if (sellerMode) url.searchParams.delete("modo"); else url.searchParams.set("modo", "vendedor");
    window.history.replaceState({}, "", url);
  };

  return <div className={`booking-page ${sellerMode?'':'booking-compact'}`}>
    <header className="booking-nav">
      <a className="booking-brand" href="https://ec10talentos.com" aria-label="EC10 Talentos - inicio">
        <img src="/booking-media/ec10-logo.png" alt="" />
        <span><strong>EC10 TALENTOS</strong><small>FUTEBOL SEM FRONTEIRAS</small></span>
      </a>
      <button className="booking-mode" type="button" onClick={switchMode}>{sellerMode ? <ArrowLeft size={16} /> : <LockKeyhole size={16} />}{sellerMode ? "Voltar ao agendamento" : "Acesso vendedores"}</button>
    </header>

    <section className="booking-hero">
      <div className="booking-hero-inner">
        <span className="booking-kicker"><CalendarDays size={16} /> AGENDA EC10</span>
        <h1>{sellerMode?'Agenda do time':booking?'Sua reunião está agendada':'Agende sua reunião'}</h1>
        <p>{sellerMode?'Organize sua disponibilidade.':`${programLabel} · Horários de Brasília${booking?'':' · Próximos 7 dias'}`}</p>
      </div>
    </section>

    <main className="booking-main">
      {sellerMode&&<div className="booking-intro"><h2>Organize sua disponibilidade</h2></div>}
      {sellerMode&&<div className="booking-service-tabs" role="tablist" aria-label="Programa da reuniao">
        {Object.entries(labels).map(([key, label]) => <button key={key} role="tab" aria-selected={service === key} className={service === key ? "active" : ""} onClick={() => switchService(key as Service)}>{label}</button>)}
      </div>}
      {!sellerMode&&!booking&&<div className="booking-progress" aria-label="Etapas do agendamento"><span className={!selectedDay?'active':''}>1 · Dia</span><span className={selectedDay&&!selectedSlot?'active':''}>2 · Horário</span><span className={selectedSlot?'active':''}>3 · Confirmar</span></div>}

      {error && <div className="booking-error" role="alert">{error}</div>}
      {!sellerMode&&!registrationToken&&<div className="booking-error" role="note">Use o link individual enviado pelo bot no WhatsApp. Ele mantém seus dados preenchidos e sua reunião salva.</div>}

      {sellerMode ? <section className="booking-seller-layout">
        {!seller ? <form className="booking-form" onSubmit={login}><span className="booking-kicker">ACESSO DO TIME</span><h3>Entrar na agenda</h3><p>Use o mesmo login do CRM para abrir seus horarios.</p><label>E-mail<input value={email} onChange={event => setEmail(event.target.value)} type="email" required autoComplete="username" /></label><label>Senha<input value={password} onChange={event => setPassword(event.target.value)} type="password" required autoComplete="current-password" /></label><button className="booking-primary" disabled={saving}>{saving ? "Entrando..." : "Entrar"}<ArrowRight size={17}/></button></form> : <>
          <form className="booking-form" onSubmit={openTime}><span className="booking-kicker">{seller.name.toUpperCase()}</span><h3>Adicionar horario</h3><p>Cada horario tem 1 hora de duracao. Compromissos reservados ficam bloqueados para novos clientes.</p><label>Dia e horario<input type="datetime-local" value={newTime} onChange={event => setNewTime(event.target.value)} required /></label><button className="booking-primary" disabled={saving}>{saving ? "Salvando..." : "Abrir horario"}<Plus size={17}/></button>{service === "plano_internacional" && !seller.name.toLowerCase().includes("pablo") && <small>A agenda internacional e reservada ao Pablo.</small>}</form>
          <div className="booking-seller-list"><div className="booking-list-heading"><h3>{canViewTeam ? "Agenda de toda a equipe" : "Seus horarios"}</h3><button title="Atualizar" onClick={() => void refreshSeller()}><RefreshCw size={17}/></button></div>{sellerSlots.length ? sellerSlots.map(slot => <div className="booking-seller-row" key={slot.id}><div><strong>{formatDate(slot.startsAt, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</strong><small>{canViewTeam ? `${slot.sellerName} · ` : ""}{labels[slot.service]} · {slot.bookingId ? `Reservado para ${slot.contactName}` : "Disponivel"}</small></div>{slot.bookingId ? <a href={`/api/booking-calendar?id=${slot.bookingId}`} title="Adicionar ao calendario"><CalendarDays size={18}/></a> : slot.canManage ? <button onClick={() => void deleteTime(slot.id)} title="Remover horario"><Trash2 size={18}/></button> : <span aria-label="Horário de outro vendedor"><LockKeyhole size={17}/></span>}</div>) : <p className="booking-empty">Nenhum horario encontrado.</p>}</div>
        </>} 
      </section> : booking ? <section className="booking-success"><div className="booking-success-icon"><Check size={34}/></div><span className="booking-kicker">ENCONTRO MARCADO</span><h3>{formatDate(booking.startsAt, { weekday: "long", day: "2-digit", month: "long" })}</h3><p>{formatDate(booking.startsAt, { hour: "2-digit", minute: "2-digit" })} · Brasilia · {booking.sellerName}</p><div className="booking-calendar-actions"><a href={googleCalendarUrl(booking)} target="_blank" rel="noreferrer"><CalendarDays size={18}/> Google Agenda</a><a href={`/api/booking-calendar?id=${booking.id}&t=${encodeURIComponent(booking.accessToken)}`}><CalendarDays size={18}/> iPhone / Apple Calendar</a></div><small>Agendamento concluído. Os detalhes da chamada também chegam ao WhatsApp informado.</small></section> : <div className="booking-client-layout">
        {chosenSlot?<button className="booking-change" type="button" onClick={()=>{setSelectedSlot('');setSelectedDay('');}}><ArrowLeft size={16}/>Alterar dia e horário</button>:<section className="booking-availability"><div className="booking-list-heading"><h3>1. Escolha o dia</h3><button onClick={() => {setSelectedSlot('');setSelectedDay('');void refreshSlots(service);}} title="Atualizar horarios"><RefreshCw size={18}/></button></div>{loading ? <p className="booking-empty">Buscando horários...</p> : !days.length ? <p className="booking-empty">Não há horários disponíveis nos próximos 7 dias. Fale com a EC10 pelo WhatsApp.</p> : <>
          <div className="booking-date-grid" aria-label="Dias disponíveis">{days.map(([day,daySlots])=><button type="button" aria-pressed={selectedDay===day} className={selectedDay===day?'selected':''} key={day} onClick={()=>{setSelectedDay(day);setSelectedSlot('');}}><small>{formatDate(daySlots[0].startsAt,{weekday:'short'})}</small><strong>{formatDate(daySlots[0].startsAt,{day:'2-digit',month:'2-digit'})}</strong></button>)}</div>
          {chosenDay&&<div className="booking-day"><h4>2. Escolha o horário · {selectedDay}</h4><div className="booking-time-grid">{chosenDay[1].map(slot=><button type="button" aria-pressed={selectedSlot===slot.id} className={selectedSlot===slot.id?'selected':''} key={slot.id} onClick={()=>setSelectedSlot(slot.id)}><Clock3 size={15}/>{formatDate(slot.startsAt,{hour:'2-digit',minute:'2-digit'})}</button>)}</div></div>}
        </>}</section>}
        {chosenSlot&&<form className="booking-form" onSubmit={reserve}>
          <h3>3. Confirme sua reunião</h3>
          <p className="booking-summary"><CalendarDays size={16}/>{formatDate(chosenSlot.startsAt,{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})} · Brasília · {programLabel}</p>
          {prefillLoaded&&<small>Dados preenchidos pelo atendimento. Confira abaixo.</small>}
          <div className="booking-contact-grid">
            <label className="booking-name">{Number(age)<18?'Nome do responsável':'Nome do participante'}<input value={name} onChange={event => setName(event.target.value)} required minLength={3} autoComplete="name" placeholder="Nome completo" /></label>
            <label>WhatsApp com DDD e país<input aria-label="WhatsApp com DDD e país" type="tel" readOnly value={phone} required autoComplete="tel" placeholder="Preenchido pelo bot" /><small>Número que iniciou o atendimento. Não precisa digitar.</small></label>
            <label>Idade do atleta<input type="number" min="8" max={service==='plano_carreira'?99:service==='eurocamp'?19:25} readOnly={prefillLoaded} value={age} onChange={event => {setAge(event.target.value);setRole(Number(event.target.value)<18?'responsavel':'atleta');}} required placeholder="Ex.: 16" /></label>
          </div>
          <label>Link do vídeo do atleta (opcional)<input type="url" value={athleteVideoUrl} onChange={event=>setAthleteVideoUrl(event.target.value)} maxLength={2048} placeholder="https://youtube.com/... ou link do Drive"/></label>
          {Number(age)<18&&<label className="booking-guardian-check"><input type="checkbox" checked={guardianConfirmed} onChange={e=>setGuardianConfirmed(e.target.checked)} required/>Sou o responsável pelo atleta e participarei da reunião.</label>}
          <small>A confirmação com dia e horário será enviada ao WhatsApp acima.</small>
          <button className="booking-primary" disabled={saving || !slots.length || !registrationToken || !prefillLoaded}>{saving ? "Confirmando..." : "Confirmar reunião"}<ArrowRight size={17}/></button>
        </form>}
      </div>}
    </main>
    <footer className="booking-footer"><span>EC10 TALENTOS · FUTEBOL SEM FRONTEIRAS</span><a href="https://ec10talentos.com">Conhecer a EC10 <ArrowRight size={15}/></a></footer>
  </div>;
}
