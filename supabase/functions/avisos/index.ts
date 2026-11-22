// Notificaciones push. La llaman tareas programadas (pg_cron):
//  modo=diario  → cada mañana: cumpleaños, partidos de hoy/mañana, votar al mejor de ayer
//  modo=cada30  → partidos nuevos y "¡ya son 4!"
//  modo=prueba  → notificación de prueba (la puede lanzar la admin desde la app)
//  modo=personalizado → mensaje escrito por la admin desde la app
//  modo=chat    → mensaje nuevo en el chat del grupo (lo lanza un trigger)
//  modo=chismes → los viernes, cuando se publican los chismes anónimos
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const fechaMadrid = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(d);
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

type Msg = { title: string; body: string; tag: string; cat?: string; url?: string; excluir?: string | null };
const TIPOS: Record<string, [string, string]> = {
  padel: ["🎾", "Pádel"], cena: ["🍽️", "Cena"], plan: ["🍻", "Plan"], viaje: ["✈️", "Viaje"], fiesta: ["🎉", "Fiesta"], otro: ["📌", "Plan"],
};
const ico = (p: any) => (TIPOS[p.tipo] || TIPOS.padel)[0];
const titulo = (p: any) => (p.tipo === "padel" || !p.tipo ? "pádel" : p.titulo || (TIPOS[p.tipo] || TIPOS.otro)[1]);

async function construir(modo: string, extra: any = {}): Promise<Msg[]> {
  const hoy = fechaMadrid(new Date());
  const manana = fechaMadrid(new Date(Date.now() + 864e5));
  const ayer = fechaMadrid(new Date(Date.now() - 864e5));
  const bonita = (iso: string) => {
    if (iso === hoy) return "hoy";
    if (iso === manana) return "mañana";
    const [y, m, d] = iso.split("-").map(Number);
    return `el ${DIAS[new Date(y, m - 1, d).getDay()]} ${d} ${MESES[m - 1]}`;
  };
  const { data: amigos } = await sb.from("amigos").select("id, nombre, cumple_dia, cumple_mes, usuario, avisos");
  const nombre = (id: string) => amigos?.find((a) => a.id === id)?.nombre || "?";
  const pareja = (ids: string[]) => (ids?.length ? ids.map(nombre).join(" y ") : "por definir");
  const detalle = (p: any) => [p.hora && (p.hora.slice(0, 5) + (p.hora_fin ? "–" + p.hora_fin.slice(0, 5) : "")), p.lugar].filter(Boolean).join(" · ");
  const asistentes = async (ids: string[]) => {
    const r: Record<string, string[]> = {};
    if (!ids.length) return r;
    const { data } = await sb.from("asistencias").select("*").in("partido_id", ids).eq("estado", "voy");
    for (const a of data || []) (r[a.partido_id] ||= []).push(a.amigo_id);
    return r;
  };
  const m: Msg[] = [];

  if (modo === "chismes") {
    const { count } = await sb.from("chismes").select("id", { count: "exact", head: true }).eq("publicado", true).gte("creado_en", new Date(Date.now() - 8 * 864e5).toISOString());
    if (count) m.push({ title: "🤫 ¡Ya salieron los chismes de la semana!", body: `${count} chisme${count === 1 ? "" : "s"} anónimo${count === 1 ? "" : "s"}. Entra a leerlos 👀`, tag: "chismes", cat: "chismes" });
  } else if (modo === "chat") {
    const { data: msg } = await sb.from("mensajes").select("*").eq("id", extra.id).maybeSingle();
    if (msg) {
      const autor = amigos?.find((a) => a.id === msg.autor);
      const texto = msg.texto ? String(msg.texto).slice(0, 200) : "📷 Foto";
      m.push({ title: `💬 ${autor?.nombre || "Alguien"}`, body: texto, tag: `chat-${msg.id}`, url: "./#chat", excluir: autor?.usuario || null, cat: "chat" });
    }
  } else if (modo === "personalizado") {
    const texto = String(extra.mensaje || "").trim().slice(0, 300);
    if (texto) m.push({ title: String(extra.titulo || "").trim().slice(0, 80) || "📣 Pendejos", body: texto, tag: `msg-${Date.now()}` });
  } else if (modo === "prueba") {
    m.push({ title: "Prueba 🎾", body: "¡Las notificaciones de Pendejos funcionan!", tag: "prueba" });
  } else if (modo === "cada30") {
    const { data: nuevos } = await sb.from("partidos").select("*").eq("aviso_nuevo", false).gte("fecha", hoy);
    for (const p of nuevos || [])
      m.push({
        title: p.tipo === "padel" || !p.tipo ? `🎾 Nuevo partido ${bonita(p.fecha)}${detalle(p) ? " · " + detalle(p) : ""}` : `${ico(p)} Nuevo plan: ${titulo(p)}`,
        body: p.tipo === "padel" || !p.tipo ? "¿Vas? Entra a la app y confirma 🙋" : `${bonita(p.fecha)[0].toUpperCase() + bonita(p.fecha).slice(1)}${detalle(p) ? " · " + detalle(p) : ""}. ¿Vas? 🙋`,
        tag: `nuevo-${p.id}`, cat: "planes",
      });
    if (nuevos?.length) await sb.from("partidos").update({ aviso_nuevo: true }).in("id", nuevos.map((p) => p.id));

    const { data: abiertos } = await sb.from("partidos").select("*").eq("tipo", "padel").eq("aviso_completo", false).is("ganador", null).gte("fecha", hoy);
    const van = await asistentes((abiertos || []).map((p) => p.id));
    const completos = (abiertos || []).filter((p) => (van[p.id] || []).length >= 4);
    for (const p of completos)
      m.push({ title: `✅ ¡Ya son 4 para ${bonita(p.fecha)}!`, body: `${van[p.id].map(nombre).join(", ")}${detalle(p) ? " · " + detalle(p) : ""}`, tag: `completo-${p.id}`, cat: "planes" });
    if (completos.length) await sb.from("partidos").update({ aviso_completo: true }).in("id", completos.map((p) => p.id));
  } else {
    const [, hm, hd] = hoy.split("-").map(Number);
    const [, mm, md] = manana.split("-").map(Number);
    for (const a of amigos || []) {
      if (a.cumple_mes === hm && a.cumple_dia === hd) m.push({ title: `🎂 ¡Hoy cumple ${a.nombre}!`, body: "No se olviden de felicitarlo 🎉", tag: `cumple-${a.id}`, cat: "cumples" });
      if (a.cumple_mes === mm && a.cumple_dia === md) m.push({ title: `🎂 Mañana cumple ${a.nombre}`, body: "Vayan pensando en el regalo 😉", tag: `cumple-m-${a.id}`, cat: "cumples" });
    }
    // pregunta del día (misma que ve la app)
    const { data: preguntas } = await sb.from("preguntas_dia").select("texto").order("id");
    if (preguntas?.length) {
      const [yy, mo, dd] = hoy.split("-").map(Number);
      const diaDelAnio = Math.round((Date.UTC(yy, mo - 1, dd) - Date.UTC(yy, 0, 0)) / 864e5);
      const p = preguntas[(diaDelAnio + yy) % preguntas.length].texto;
      m.push({ title: "🤔 Pregunta del día", body: `${p} Vota en la app 👀`, tag: `pregunta-${hoy}`, cat: "pregunta" });
    }
    const { data: deAyer } = await sb.from("partidos").select("id").eq("fecha", ayer).eq("tipo", "padel");
    if (deAyer?.length) m.push({ title: "⭐ ¿Quién fue el mejor de ayer?", body: "Entra a la app y vota al mejor jugador del día", tag: `voto-${ayer}`, cat: "votos" });

    const { data: partidos } = await sb.from("partidos").select("*").in("fecha", [hoy, manana]).is("ganador", null);
    const van = await asistentes((partidos || []).map((p) => p.id));
    for (const p of partidos || []) {
      const n = (van[p.id] || []).length;
      const conParejas = p.equipo_a?.length || p.equipo_b?.length;
      const padel = p.tipo === "padel" || !p.tipo;
      m.push({
        title: padel ? `🎾 ${p.fecha === hoy ? "Hoy" : "Mañana"} hay pádel${detalle(p) ? " · " + detalle(p) : ""}` : `${ico(p)} ${p.fecha === hoy ? "Hoy" : "Mañana"}: ${titulo(p)}${detalle(p) ? " · " + detalle(p) : ""}`,
        body: padel
          ? (conParejas ? `${pareja(p.equipo_a)} vs ${pareja(p.equipo_b)}` : n >= 4 ? `Van: ${van[p.id].map(nombre).join(", ")}` : `Van ${n}/4. ¿Te apuntas? 🙋`)
          : (n ? `Van: ${van[p.id].map(nombre).join(", ")}` : "¿Quién se apunta? 🙋"),
        tag: `partido-${p.id}-${p.fecha === hoy ? "hoy" : "manana"}`, cat: "planes",
      });
    }
  }
  return m;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { data: cfg } = await sb.from("config_privada").select("clave, valor");
    const c = Object.fromEntries((cfg || []).map((x) => [x.clave, x.valor]));
    const body = await req.json().catch(() => ({}));
    const modo = body.modo || "diario";

    // ¿Quién llama? La tarea programada (con token) o la admin desde la app (solo prueba)
    let permitido = req.headers.get("x-token") === c.TOKEN_CRON;
    if (!permitido && (modo === "prueba" || modo === "personalizado")) {
      const jwt = (req.headers.get("authorization") || "").replace("Bearer ", "");
      const { data: u } = await sb.auth.getUser(jwt);
      if (u?.user) {
        const { data: a } = await sb.from("amigos").select("es_admin").eq("usuario", u.user.id).maybeSingle();
        permitido = !!a?.es_admin;
      }
    }
    if (!permitido) return json({ error: "No autorizado" }, 401);

    const mensajes = await construir(modo, body);
    if (!mensajes.length) return json({ modo, enviados: 0, nota: "Nada que avisar" });

    webpush.setVapidDetails("mailto:avisos@pendejos.app", c.VAPID_PUBLIC_KEY, c.VAPID_PRIVATE_KEY);
    const { data: subs } = await sb.from("suscripciones_push").select("*");
    const { data: prefs } = await sb.from("amigos").select("usuario, avisos");
    const prefDe = (uid: string) => (prefs || []).find((p) => p.usuario === uid)?.avisos || {};
    let enviados = 0;
    for (const s of subs || []) {
      for (const msg of mensajes as any[]) {
        if (msg.excluir && s.usuario === msg.excluir) continue; // no avisar a quien lo escribió
        if (msg.cat && prefDe(s.usuario)[msg.cat] === false) continue; // lo silenció
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: msg.title, body: msg.body, tag: msg.tag, url: msg.url }));
          enviados++;
        } catch (err: any) {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await sb.from("suscripciones_push").delete().eq("endpoint", s.endpoint);
            break;
          }
          console.error("push", err?.statusCode, err?.body);
        }
      }
    }
    return json({ modo, mensajes: mensajes.length, celulares: subs?.length || 0, enviados });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
