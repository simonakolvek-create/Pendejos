import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------- Configuración ----------
const C = window.APP_CONFIG || {};
const CONFIGURADO = /^https?:\/\//.test(C.supabaseUrl || "");
const sb = CONFIGURADO ? createClient(C.supabaseUrl, C.supabaseAnonKey) : null;
const BUCKET = "recuerdos";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS_CORTOS = ["L", "M", "M", "J", "V", "S", "D"];
const DIAS_LARGOS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

// ---------- Estado ----------
const st = {
  usuario: null,
  amigos: [],
  partidos: [],
  recuerdos: [],
  inicio: null,
  publicaciones: [],
  esAdmin: false,
  asistencias: [],
  votos: [],
  comentarios: [],
  reacciones: [],
  torneos: [],
  extras: false,      // true cuando ya se corrió extras.sql
  yo: null,           // id del amigo vinculado a esta cuenta
  preguntado: false,
  reabrir: null,      // para refrescar la ventana abierta
  mensajes: [],
  navidad: null,
  preguntas: [],
  votosPregunta: [],
  chismes: [],
  chismesPendientes: 0,
  puntuaciones: [],
  ajustes: [],
  adviento: [],
  intercambio: [],
  deseos: [],
  pistas: [],
  borrador: "",
  respondiendo: null,
  urls: {},
  tab: "inicio",
  mes: null,          // [año, índiceMes]
  dia: null,          // "AAAA-MM-DD"
  anioRanking: "todo",
};

// ---------- Utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoyISO = () => iso(new Date());
const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fechaLarga = (s) => { const d = parseISO(s); return `${DIAS_LARGOS[(d.getDay() + 6) % 7]} ${d.getDate()} de ${MESES[d.getMonth()]}`; };
const fechaCorta = (s) => { const d = parseISO(s); return `${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`; };
const hora = (h) => (h ? h.slice(0, 5) : "");
const horario = (p) => (p.hora ? hora(p.hora) + (p.hora_fin ? "–" + hora(p.hora_fin) : "") : "");
const nombre = (id) => st.amigos.find((a) => a.id === id)?.nombre || "(borrado)";
const equipo = (ids) => (ids && ids.length ? ids.map((i) => esc(nombre(i))).join(" y ") : "Por definir");
const mesClave = (y, m) => `${y}-${pad(m + 1)}`;

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 3000);
}

function diasHastaCumple(a) {
  if (!a.cumple_mes || !a.cumple_dia) return null;
  const h = parseISO(hoyISO());
  let d = new Date(h.getFullYear(), a.cumple_mes - 1, a.cumple_dia);
  if (d < h) d = new Date(h.getFullYear() + 1, a.cumple_mes - 1, a.cumple_dia);
  return Math.round((d - h) / 86400000);
}
const textoCumple = (a) => (a.cumple_mes ? `${a.cumple_dia} de ${MESES[a.cumple_mes - 1]}` : "Sin fecha");

function error(e) {
  console.error(e);
  toast("Algo falló: " + (e?.message || e));
}

// ---------- Arranque ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(console.error);

async function iniciar() {
  document.title = C.nombreApp || "Pendejos";
  if (!CONFIGURADO) return vistaSinConfigurar();
  const { data } = await sb.auth.getSession();
  st.usuario = data.session?.user || null;
  sb.auth.onAuthStateChange((_e, sesion) => {
    const antes = st.usuario?.id;
    st.usuario = sesion?.user || null;
    if (antes !== st.usuario?.id) arrancarSesion();
  });
  arrancarSesion();
}

function arrancarSesion() {
  if (!st.usuario) return vistaLogin();
  // mes inicial: el actual (o el más cercano dentro del rango)
  const hoy = new Date();
  const [dy, dm] = C.calendarioDesde.split("-").map(Number);
  const [hy, hm] = C.calendarioHasta.split("-").map(Number);
  let clave = mesClave(hoy.getFullYear(), hoy.getMonth());
  if (clave < C.calendarioDesde) st.mes = [dy, dm - 1];
  else if (clave > C.calendarioHasta) st.mes = [hy, hm - 1];
  else st.mes = [hoy.getFullYear(), hoy.getMonth()];
  st.dia = clave === mesClave(...st.mes) ? hoyISO() : iso(new Date(st.mes[0], st.mes[1], 1));
  if (location.hash === "#chat") st.tab = "chat";
  pintarEstructura();
  cargarTodo().then(conectarChat);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && st.usuario) cargarTodo();
});

// ---------- Datos ----------
async function cargarTodo() {
  try {
    const [a, p, r, ini, pub] = await Promise.all([
      sb.from("amigos").select("*").order("nombre"),
      sb.from("partidos").select("*").order("fecha").order("hora", { nullsFirst: true }),
      sb.from("recuerdos").select("*").order("fecha", { ascending: false }).order("creado_en", { ascending: false }),
      sb.from("inicio").select("*").eq("id", 1).maybeSingle(),
      sb.from("publicaciones").select("*").order("fijada", { ascending: false }).order("creado_en", { ascending: false }),
    ]);
    const [as, vo, co, re, to, ms, fr, na, ad, pq, vp, ch, cp, pu, aj] = await Promise.all([
      sb.from("asistencias").select("*"),
      sb.from("votos_dia").select("*"),
      sb.from("comentarios").select("*").order("creado_en"),
      sb.from("reacciones").select("*"),
      sb.from("torneos").select("*").order("fecha", { ascending: false }).order("creado_en", { ascending: false }),
      sb.from("mensajes").select("*").order("creado_en", { ascending: false }).limit(300),
      sb.from("frases").select("texto").order("id"),
      sb.from("navidad").select("*").eq("id", 1).maybeSingle(),
      sb.from("adviento").select("*").order("dia"),
      sb.from("preguntas_dia").select("texto").order("id"),
      sb.from("votos_pregunta").select("*").gte("fecha", iso(new Date(Date.now() - 7 * 864e5))),
      sb.from("chismes").select("*").order("creado_en", { ascending: false }).limit(100),
      sb.rpc("chismes_pendientes"),
      sb.from("puntuaciones").select("amigo_id, puntos").order("puntos", { ascending: false }).limit(200),
      sb.from("ajustes").select("*"),
    ]);
    for (const x of [a, p, r]) if (x.error) throw x.error;
    st.amigos = a.data;
    st.partidos = p.data;
    st.recuerdos = r.data;
    // Inicio (si aún no corriste inicio.sql, simplemente queda vacío)
    st.inicio = ini.error ? null : ini.data;
    st.publicaciones = pub.error ? [] : pub.data;

    // Funciones extra (si aún no corriste extras.sql, se ocultan)
    st.extras = !as.error;
    st.asistencias = as.error ? [] : as.data;
    st.votos = vo.error ? [] : vo.data;
    st.comentarios = co.error ? [] : co.data;
    st.reacciones = re.error ? [] : re.data;
    st.torneos = to.error ? [] : to.data;
    st.mensajes = ms.error ? [] : ms.data.reverse();
    st.frases = fr.error ? [] : fr.data;
    st.navidad = na.error ? null : na.data;
    st.adviento = ad.error ? [] : ad.data;
    st.preguntas = pq.error ? [] : pq.data;
    st.votosPregunta = vp.error ? [] : vp.data;
    st.chismes = ch.error ? [] : ch.data;
    st.chismesPendientes = cp.error ? 0 : cp.data || 0;
    st.puntuaciones = pu.error ? [] : pu.data;
    st.ajustes = aj.error ? [] : aj.data;
    const yo = st.amigos.find((x) => x.usuario && x.usuario === st.usuario.id);
    st.yo = yo?.id || null;
    st.esAdmin = !!yo?.es_admin;
    await firmarFotos();
    pintar();
    if (st.reabrir && document.querySelector(".velo")) st.reabrir();
    if (st.extras && !st.yo && !st.preguntado) { st.preguntado = true; quienEres(); }
    else if (st.yo && !st.bienvenidaVista) { st.bienvenidaVista = true; bienvenida(); }
  } catch (e) { error(e); }
}

async function firmarFotos() {
  const rutas = [
    ...st.recuerdos.map((r) => r.ruta),
    st.inicio?.portada_ruta,
    ...st.publicaciones.map((x) => x.imagen_ruta),
    ...st.amigos.map((a) => a.foto_ruta),
    ...st.amigos.map((a) => a.foto_padel_ruta),
    ...st.mensajes.map((m) => m.imagen_ruta),
  ];
  const faltan = [...new Set(rutas.filter((ruta) => ruta && !st.urls[ruta]))];
  if (!faltan.length) return;
  const { data, error: e } = await sb.storage.from(BUCKET).createSignedUrls(faltan, 60 * 60 * 6);
  if (e) throw e;
  for (const x of data) if (x.signedUrl) st.urls[x.path] = x.signedUrl;
}

// ---------- Pantallas sin sesión ----------
function vistaSinConfigurar() {
  $("#app").innerHTML = `
    <div class="centro">
      <img class="logoImg" src="icons/p-192.png" alt="">
      <h1>Falta un paso</h1>
      <p>Abre <b>config.js</b> y pega la URL y la clave de tu proyecto de Supabase (te lo explica la guía).</p>
    </div>`;
}

async function vistaLogin() {
  $("#app").innerHTML = `
    <div class="centro">
      <img class="logoImg" src="icons/p-192.png" alt="">
      <h1>${esc(C.nombreApp)}</h1>
      <p class="sub">¿Quién eres?</p>
      <div class="chips grandes centrados" id="nombres"><span class="sub">Cargando…</span></div>
      <form id="fLogin" class="tarjeta form" style="margin-top:16px">
        <label>Código del grupo<input name="codigo" autocomplete="off" autocapitalize="none" required placeholder="Te lo pasan por WhatsApp"></label>
        <button class="btn primario" type="submit">Entrar</button>
      </form>
    </div>`;
  let elegido = null;
  const { data, error: e } = await sb.functions.invoke("entrar", { body: { accion: "nombres" } });
  if (e) { $("#nombres").innerHTML = `<span class="sub">No se pudo cargar. Revisa tu internet.</span>`; return; }
  $("#nombres").innerHTML = data.nombres.map((a) => `<button type="button" class="chip" data-id="${a.id}">${esc(a.nombre)}</button>`).join("");
  document.querySelectorAll("#nombres .chip").forEach((b) => (b.onclick = () => {
    elegido = b.dataset.id;
    document.querySelectorAll("#nombres .chip").forEach((x) => x.classList.toggle("on", x === b));
  }));
  $("#fLogin").onsubmit = async (ev) => {
    ev.preventDefault();
    if (!elegido) return toast("Toca tu nombre primero");
    const codigo = new FormData(ev.target).get("codigo").trim();
    const btn = ev.target.querySelector("button");
    btn.disabled = true; btn.textContent = "Entrando…";
    try {
      const r = await sb.functions.invoke("entrar", { body: { amigo_id: elegido, codigo } });
      if (r.error) {
        let msg = "No se pudo entrar";
        try { msg = (await r.error.context.json()).error || msg; } catch {}
        throw new Error(msg);
      }
      const { error: e2 } = await sb.auth.setSession(r.data);
      if (e2) throw e2;
    } catch (e) {
      toast(e.message);
      btn.disabled = false; btn.textContent = "Entrar";
    }
  };
}

// ---------- Estructura principal ----------
const TABS = [
  ["inicio", "🏠", "Inicio"],
  ["calendario", "📅", "Calendario"],
  ["chat", "💬", "Chat"],
  ["ranking", "🎾", "Pádel"],
  ["recuerdos", "📸", "Momentos"],
  ["amigos", "🎂", "Cumple"],
];

function pintarEstructura() {
  $("#app").innerHTML = `
    <header class="barra">
      <h1>${esc(C.nombreApp)}</h1>
      <div class="acciones">
        <button id="bPerfil" class="avatarBtn" title="Mi perfil"></button>
        <button id="bAvisos" class="icono" title="Notificaciones">🔔</button>
        <button id="bSalir" class="salir" title="Cerrar sesión">Salir</button>
      </div>
    </header>
    <main id="vista"></main>
    <nav class="tabs">
      ${TABS.map(([k, ico, txt]) => `<button data-tab="${k}"><span>${ico}</span>${txt}</button>`).join("")}
    </nav>`;
  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => { st.tab = b.dataset.tab; pintar(); if (st.tab === "chat") bajarChat(); else window.scrollTo(0, 0); }));
  $("#bSalir").onclick = async () => { if (confirm("¿Cerrar sesión?")) await sb.auth.signOut(); };
  $("#bAvisos").onclick = abrirAvisos;
  $("#bPerfil").onclick = () => st.yo && verPerfil(st.yo);
}

function pintar() {
  if (!$("#vista")) return;
  const yo = st.amigos.find((a) => a.id === st.yo);
  if ($("#bPerfil")) $("#bPerfil").innerHTML = yo ? avatar(yo, "chico") : "";
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("activo", b.dataset.tab === st.tab));
  document.body.classList.toggle("enChat", st.tab === "chat");
  pintarBadgeChat();
  const v = { chat: vistaChat, inicio: vistaInicio, calendario: vistaCalendario, ranking: vistaPadel, recuerdos: vistaRecuerdos, amigos: vistaAmigos }[st.tab];
  $("#vista").innerHTML = v();
  enlazar[st.tab]?.();
}

// ---------- Calendario ----------
const cumplesDe = (y, m, d) => st.amigos.filter((a) => a.cumple_mes === m + 1 && a.cumple_dia === d);

function vistaCalendario() {
  const [y, m] = st.mes;
  const offset = (new Date(y, m, 1).getDay() + 6) % 7;
  const total = new Date(y, m + 1, 0).getDate();
  const hoy = hoyISO();
  const porFecha = {};
  for (const p of st.partidos) (porFecha[p.fecha] ||= []).push(p);

  let celdas = "";
  for (let i = 0; i < offset; i++) celdas += `<div></div>`;
  for (let d = 1; d <= total; d++) {
    const f = `${y}-${pad(m + 1)}-${pad(d)}`;
    const ps = porFecha[f] || [];
    const cs = cumplesDe(y, m, d);
    const clases = ["dia", f === hoy && "hoy", f === st.dia && "sel", ps.length && "conPartido"].filter(Boolean).join(" ");
    celdas += `<button class="${clases}" data-f="${f}">
      <span class="num">${d}</span>
      <span class="marcas">${ps.map((p) => `<i class="pt ${esPadel(p) ? (p.ganador ? "jugado" : "") : "otro"}"></i>`).join("")}${cs.length ? "🎂" : ""}</span>
    </button>`;
  }

  const puedeAtras = mesClave(y, m) > C.calendarioDesde;
  const puedeAdelante = mesClave(y, m) < C.calendarioHasta;
  const [sy, sm, sd] = st.dia.split("-").map(Number);
  const partidosDia = porFecha[st.dia] || [];
  const cumplesDia = cumplesDe(sy, sm - 1, sd);
  const proximos = st.partidos.filter((p) => !yaPaso(p)).slice(0, 3);
  const cumplesHoy = st.amigos.filter((a) => diasHastaCumple(a) === 0);

  return `
    ${cumplesHoy.length ? `<div class="aviso">🎉 ¡Hoy cumple ${cumplesHoy.map((a) => esc(a.nombre)).join(" y ")}! Felicítenlo.</div>` : ""}
    <section class="tarjeta">
      <div class="mesNav">
        <button class="icono" id="mAtras" ${puedeAtras ? "" : "disabled"}>‹</button>
        <h2>${MESES[m]} ${y}</h2>
        <button class="icono" id="mAdelante" ${puedeAdelante ? "" : "disabled"}>›</button>
      </div>
      <div class="grid semana">${DIAS_CORTOS.map((d) => `<div>${d}</div>`).join("")}</div>
      <div class="grid">${celdas}</div>
      <div class="leyenda"><span><i class="pt"></i> Pádel</span><span><i class="pt jugado"></i> Con resultado</span><span><i class="pt otro"></i> Otro plan</span><span>🎂 Cumpleaños</span></div>
    </section>

    <section class="tarjeta">
      <h3>${fechaLarga(st.dia)}</h3>
      ${cumplesDia.map((a) => `<div class="fila cumple">🎂 Cumple de <b>${esc(a.nombre)}</b></div>`).join("")}
      ${partidosDia.map(tarjetaPartido).join("")}
      ${st.extras ? bloqueMejorDia(st.dia) : ""}
      ${!partidosDia.length && !cumplesDia.length ? `<p class="vacio">Nada agendado este día.</p>` : ""}
      <button class="btn primario ancho" id="nuevoPartido">+ Agendar</button>
    </section>

    ${proximos.length ? `<section class="tarjeta"><h3>Próximos planes</h3>
      ${proximos.map((p) => `<button class="fila clic" data-ir="${p.fecha}">${TIPOS[tipoDe(p)].ico} <b>${esc(tituloEvento(p))}</b> · ${fechaLarga(p.fecha)}${p.hora ? " · " + hora(p.hora) : ""}${p.lugar ? " · " + esc(p.lugar) : ""}</button>`).join("")}
    </section>` : ""}`;
}

function tarjetaPartido(p) {
  if (!esPadel(p)) {
    const t = TIPOS[tipoDe(p)];
    return `<div class="partidoBox evento"><button class="partido" data-id="${p.id}">
      <div class="meta">${t.ico} ${t.txt} · ${p.hora ? horario(p) : "Hora por definir"}${p.lugar ? " · " + esc(p.lugar) : ""}</div>
      <div class="tituloEvento">${esc(tituloEvento(p))}</div>
      ${p.notas ? `<div class="meta">${esc(p.notas)}</div>` : ""}
    </button>${st.extras && !yaPaso(p) ? filaQuienVa(p) : ""}</div>`;
  }
  const gA = p.ganador === "A", gB = p.ganador === "B";
  return `<div class="partidoBox"><button class="partido" data-id="${p.id}">
    <div class="meta">🎾 ${p.hora ? horario(p) : "Hora por definir"}${p.lugar ? " · " + esc(p.lugar) : ""}</div>
    ${p.equipo_a?.length || p.equipo_b?.length ? `<div class="vs">
      <span class="${gA ? "gana" : ""}">${gA ? "🏆 " : ""}${equipo(p.equipo_a)}</span>
      <em>vs</em>
      <span class="${gB ? "gana" : ""}">${gB ? "🏆 " : ""}${equipo(p.equipo_b)}</span>
    </div>` : p.jugadores?.length ? `<div class="tituloEvento">Pádel ✅</div><div class="meta">👥 Jugaron: ${p.jugadores.map((i) => esc(nombre(i))).join(", ")}</div>`
      : `<div class="tituloEvento">Pádel</div><div class="meta">Parejas por definir</div>`}
    <div class="meta">${p.marcador ? "Marcador: " + esc(p.marcador) : p.ganador ? "" : yaPaso(p) ? "Toca si quieres apuntar parejas y resultado" : "Toca para apuntar el resultado"}</div>
  </button>${yaPaso(p) ? filaFotosPartido(p) : ""}${p.lugar && !yaPaso(p) ? `<a class="comoLlegar" href="${esc(mapa(p.lugar))}" target="_blank" rel="noopener">📍 Cómo llegar</a>` : ""}${st.extras && !yaPaso(p) ? filaQuienVa(p) : ""}</div>`;
}

const enlazar = {
  chat() { enlazarChat(); },
  inicio() {
    enlazarChismes();
    const ir = (tab) => { st.tab = tab; pintar(); window.scrollTo(0, 0); };
    document.querySelectorAll("[data-tab-ir]").forEach((b) => (b.onclick = () => {
      if (b.dataset.fecha) { const d = parseISO(b.dataset.fecha); st.mes = [d.getFullYear(), d.getMonth()]; st.dia = b.dataset.fecha; }
      ir(b.dataset.tabIr);
    }));
    $("#editarPortada")?.addEventListener("click", formPortada);
    $("#nuevaPub")?.addEventListener("click", () => formPublicacion(null));
    document.querySelectorAll("[data-pub]").forEach((b) => (b.onclick = () => formPublicacion(st.publicaciones.find((x) => x.id === b.dataset.pub))));
    document.querySelectorAll(".mini").forEach((b) => (b.onclick = () => verFoto(st.recuerdos.find((r) => r.id === b.dataset.id))));
  },
  calendario() {
    const mover = (delta) => {
      let [y, m] = st.mes;
      m += delta;
      if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
      st.mes = [y, m];
      st.dia = mesClave(y, m) === hoyISO().slice(0, 7) ? hoyISO() : iso(new Date(y, m, 1));
      pintar();
    };
    $("#mAtras").onclick = () => mover(-1);
    $("#mAdelante").onclick = () => mover(1);
    document.querySelectorAll(".dia").forEach((b) => (b.onclick = () => { st.dia = b.dataset.f; pintar(); }));
    document.querySelectorAll(".partido").forEach((b) => (b.onclick = () => formPartido(st.partidos.find((p) => p.id === b.dataset.id))));
    document.querySelectorAll("[data-ir]").forEach((b) => (b.onclick = () => {
      const d = parseISO(b.dataset.ir);
      st.mes = [d.getFullYear(), d.getMonth()];
      st.dia = b.dataset.ir;
      pintar();
    }));
    $("#nuevoPartido").onclick = () => formPartido(null);
  },
  ranking() {
    $("#editarPremio")?.addEventListener("click", editarPremio);
    $("#subirCromo")?.addEventListener("change", (e) => { if (e.target.files[0]) subirCromo(e.target.files[0]); });
    $("#anio").onchange = (e) => { st.anioRanking = e.target.value; pintar(); };
    $("#nuevoTorneo")?.addEventListener("click", formTorneo);
    document.querySelectorAll("[data-torneo]").forEach((b) => (b.onclick = () => verTorneo(b.dataset.torneo)));
  },
  recuerdos() {
    $("#subir").onchange = (e) => { if (e.target.files.length) formFotos([...e.target.files]); e.target.value = ""; };
    document.querySelectorAll(".foto").forEach((b) => (b.onclick = () => verFoto(st.recuerdos.find((r) => r.id === b.dataset.id))));
  },
  amigos() {
    $("#nuevoAmigo").onclick = () => formAmigo(null);
    $("#soyYo")?.addEventListener("click", quienEres);
    document.querySelectorAll("[data-amigo]").forEach((b) => (b.onclick = () => verPerfil(b.dataset.amigo)));
  },
};

// ---------- Hoja (ventana inferior) ----------
function hoja(html, reabrir = null) {
  const yaAbierta = !!document.querySelector(".velo");
  cerrarHoja();
  st.reabrir = reabrir;
  const div = document.createElement("div");
  div.className = "velo" + (reabrir && yaAbierta ? " sinAnim" : "");
  div.innerHTML = `<div class="hoja" role="dialog">${html}</div>`;
  div.addEventListener("click", (e) => { if (e.target === div) cerrarHoja(); });
  document.body.appendChild(div);
  document.body.classList.add("bloqueado");
  return div;
}
function cerrarHoja() {
  st.reabrir = null;
  document.querySelector(".velo")?.remove();
  document.body.classList.remove("bloqueado");
}

// ---------- Cancha de siempre ----------
const CANCHA = "Padel Court Daoíz y Velarde";
const mapa = (lugar) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(lugar + ", Madrid");

// ---------- Tipos de evento ----------
const TIPOS = {
  padel: { ico: "🎾", txt: "Pádel" },
  cena: { ico: "🍽️", txt: "Cena" },
  plan: { ico: "🍻", txt: "Plan" },
  viaje: { ico: "✈️", txt: "Viaje" },
  fiesta: { ico: "🎉", txt: "Fiesta" },
  otro: { ico: "📌", txt: "Otro" },
};
// Un plan ya pasó si: tiene resultado, es de un día anterior, la admin ya marcó quién jugó,
// o es de hoy y ya pasaron 2 horas de su hora de inicio
function yaPaso(p) {
  const hoy = hoyISO();
  if (p.ganador || p.fecha < hoy || (p.jugadores && p.jugadores.length)) return true;
  if (p.fecha === hoy && p.hora) {
    const min = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const fin = p.hora_fin ? min(p.hora_fin) : min(p.hora) + 120;
    const ahora = new Date();
    return ahora.getHours() * 60 + ahora.getMinutes() >= fin;
  }
  return false;
}
const tipoDe = (p) => TIPOS[p.tipo] ? p.tipo : "padel";
const esPadel = (p) => tipoDe(p) === "padel";
const tituloEvento = (p) => (esPadel(p) ? "Pádel" : p.titulo || TIPOS[tipoDe(p)].txt);

// ---------- Formulario de evento ----------
function formPartido(p) {
  const nuevo = !p;
  let tipo = p ? tipoDe(p) : "padel";
  const sel = { A: [...(p?.equipo_a || [])], B: [...(p?.equipo_b || [])] };
  const v = hoja(`
    <h3>${nuevo ? "Agendar" : "Editar"}</h3>
    <form id="fPartido" class="form">
      <div class="chips tipos">${Object.entries(TIPOS).map(([k, t]) => `<button type="button" class="chip ${k === tipo ? "on" : ""}" data-tipo="${k}">${t.ico} ${t.txt}</button>`).join("")}</div>
      <label class="soloOtros">Título<input name="titulo" placeholder="Cena de Navidad, cumple de Patri…" value="${esc(p?.titulo)}"></label>
      <label>Fecha<input name="fecha" type="date" required value="${p?.fecha || st.dia}" min="${C.calendarioDesde}-01" max="${C.calendarioHasta}-31"></label>
      <div class="dos">
        <label>Empieza<input name="hora" type="time" value="${hora(p?.hora)}"></label>
        <label>Termina<input name="hora_fin" type="time" value="${hora(p?.hora_fin)}"></label>
      </div>
      <p class="soloPadel canchaFija">📍 ${esc(CANCHA)}</p>
      <label class="soloOtros">Lugar<input name="lugar" placeholder="Restaurante, casa de alguien…" value="${esc(p && !esPadel(p) ? p.lugar : "")}"></label>
      <div class="soloPadel">
      ${st.amigos.length ? "" : `<p class="vacio">Primero agrega a tus amigos en la pestaña 🎂 Cumple para elegir las parejas.</p>`}
      ${st.extras && p && vanA(p).length >= 4 ? `<button type="button" class="btn negro" id="sortearPartido">🎲 Sortear parejas entre los que van (${vanA(p).length})</button>` : ""}
      <div class="equipo"><b>Pareja A</b><div class="chips" data-eq="A"></div></div>
      <div class="equipo"><b>Pareja B</b><div class="chips" data-eq="B"></div></div>
      <fieldset class="ganador">
        <legend>¿Quién ganó?</legend>
        <label><input type="radio" name="ganador" value="" ${!p?.ganador ? "checked" : ""}> Aún no se juega</label>
        <label><input type="radio" name="ganador" value="A" ${p?.ganador === "A" ? "checked" : ""}> Pareja A</label>
        <label><input type="radio" name="ganador" value="B" ${p?.ganador === "B" ? "checked" : ""}> Pareja B</label>
      </fieldset>
      <label>Marcador (opcional)<input name="marcador" placeholder="6-4 3-6 7-5" value="${esc(p?.marcador)}"></label>
      </div>
      <label>Notas<textarea name="notas" rows="2" placeholder="Quién reserva, qué llevar…">${esc(p?.notas)}</textarea></label>
      <div class="botones">
        ${nuevo ? "" : `<button type="button" class="btn peligro" id="borrar">Borrar</button>`}
        <button type="button" class="btn" id="cancelar">Cancelar</button>
        <button type="submit" class="btn primario">Guardar</button>
      </div>
    </form>`);

  const pintarChips = () => {
    v.querySelectorAll(".chips[data-eq]").forEach((c) => {
      const eq = c.dataset.eq, otro = eq === "A" ? "B" : "A";
      c.innerHTML = st.amigos.map((a) => {
        const on = sel[eq].includes(a.id), bloqueado = sel[otro].includes(a.id);
        return `<button type="button" class="chip ${on ? "on" : ""}" data-id="${a.id}" ${bloqueado ? "disabled" : ""}>${esc(a.nombre)}</button>`;
      }).join("");
      c.querySelectorAll(".chip").forEach((b) => (b.onclick = () => {
        const id = b.dataset.id, lista = sel[eq];
        if (lista.includes(id)) lista.splice(lista.indexOf(id), 1);
        else if (lista.length < 2) lista.push(id);
        else return toast("Máximo 2 por pareja");
        pintarChips();
      }));
    });
  };
  pintarChips();
  const pintarTipo = () => {
    v.querySelectorAll("[data-tipo]").forEach((b) => b.classList.toggle("on", b.dataset.tipo === tipo));
    v.querySelectorAll(".soloPadel").forEach((x) => (x.hidden = tipo !== "padel"));
    v.querySelectorAll(".soloOtros").forEach((x) => (x.hidden = tipo === "padel"));
  };
  v.querySelectorAll("[data-tipo]").forEach((b) => (b.onclick = () => { tipo = b.dataset.tipo; pintarTipo(); }));
  pintarTipo();
  $("#sortearPartido", v)?.addEventListener("click", () => {
    const m = mezclar(vanA(p)).slice(0, 4);
    sel.A = m.slice(0, 2); sel.B = m.slice(2, 4);
    pintarChips();
    toast("🎲 ¡Parejas sorteadas! Dale a Guardar");
  });

  $("#cancelar", v).onclick = cerrarHoja;
  if (!nuevo) $("#borrar", v).onclick = async () => {
    if (!confirm("¿Borrar este evento?")) return;
    const { error: e } = await sb.from("partidos").delete().eq("id", p.id);
    if (e) return error(e);
    cerrarHoja(); toast("Borrado"); cargarTodo();
  };
  $("#fPartido", v).onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const padel = tipo === "padel";
    const datos = {
      tipo,
      titulo: padel ? null : f.get("titulo").trim() || null,
      fecha: f.get("fecha"),
      hora: f.get("hora") || null,
      hora_fin: f.get("hora_fin") || null,
      lugar: padel ? CANCHA : f.get("lugar").trim() || null,
      equipo_a: padel ? sel.A : [],
      equipo_b: padel ? sel.B : [],
      ganador: padel ? f.get("ganador") || null : null,
      marcador: padel ? f.get("marcador").trim() || null : null,
      notas: f.get("notas").trim() || null,
    };
    const q = nuevo ? sb.from("partidos").insert(datos) : sb.from("partidos").update(datos).eq("id", p.id);
    const { error: e } = await q;
    if (e) return error(e);
    cerrarHoja();
    toast(datos.ganador ? "¡Resultado guardado! 🏆" : `Agendado ${TIPOS[tipo].ico}`);
    const d = parseISO(datos.fecha);
    st.mes = [d.getFullYear(), d.getMonth()];
    st.dia = datos.fecha;
    cargarTodo();
  };
}

// ---------- Ranking ----------
function calcularRanking(anio) {
  const jugados = st.partidos.filter((p) => p.ganador && (anio === "todo" || p.fecha.startsWith(anio)));
  const s = new Map();
  const sumar = (id, gano) => {
    const x = s.get(id) || { id, j: 0, g: 0 };
    x.j++; if (gano) x.g++;
    s.set(id, x);
  };
  for (const p of jugados) {
    p.equipo_a.forEach((id) => sumar(id, p.ganador === "A"));
    p.equipo_b.forEach((id) => sumar(id, p.ganador === "B"));
  }
  const tabla = [...s.values()]
    .map((x) => ({ ...x, pct: Math.round((x.g / x.j) * 100) }))
    .sort((a, b) => b.g - a.g || b.pct - a.pct || b.j - a.j);
  return { tabla, jugados };
}

function vistaRanking() {
  const anios = [...new Set(st.partidos.map((p) => p.fecha.slice(0, 4)))].sort();
  const { tabla, jugados } = calcularRanking(st.anioRanking);
  const medalla = (i) => ["🥇", "🥈", "🥉"][i] || `${i + 1}.`;
  const ultimos = [...jugados].reverse().slice(0, 8);

  return `
    ${st.extras ? seccionMejorJugador(st.anioRanking) : ""}
    <section class="tarjeta">
      <div class="mesNav">
        <h2>🏆 Victorias</h2>
        <select id="anio">
          <option value="todo">Todos</option>
          ${anios.map((a) => `<option value="${a}" ${st.anioRanking === a ? "selected" : ""}>${a}</option>`).join("")}
        </select>
      </div>
      ${tabla.length ? `<table class="tabla">
        <thead><tr><th></th><th>Jugador</th><th>Victorias</th><th>Jugados</th><th>%</th></tr></thead>
        <tbody>${tabla.map((x, i) => `<tr><td>${medalla(i)}</td><td>${esc(nombre(x.id))}</td><td><b>${x.g}</b></td><td>${x.j}</td><td>${x.pct}%</td></tr>`).join("")}</tbody>
      </table>` : `<p class="vacio">Todavía no hay resultados. Apunta quién ganó en el calendario.</p>`}
    </section>
    ${seccionesExtraRanking(st.anioRanking)}
    ${ultimos.length ? `<section class="tarjeta"><h3>Últimos resultados</h3>
      ${ultimos.map((p) => `<div class="fila"><small>${fechaCorta(p.fecha)}</small><br>🏆 <b>${equipo(p.ganador === "A" ? p.equipo_a : p.equipo_b)}</b> le ganaron a ${equipo(p.ganador === "A" ? p.equipo_b : p.equipo_a)}${p.marcador ? ` <small>(${esc(p.marcador)})</small>` : ""}</div>`).join("")}
    </section>` : ""}`;
}

// ---------- Inicio ----------
function vistaInicio() {
  const hoy = hoyISO();
  const ini = st.inicio;
  const portada = ini?.portada_ruta && st.urls[ini.portada_ruta];
  const prox = st.partidos.find((p) => !yaPaso(p));
  const cumple = st.amigos.filter((a) => a.cumple_mes).map((a) => ({ a, d: diasHastaCumple(a) })).sort((x, y) => x.d - y.d)[0];
  const lider = calcularRanking(hoy.slice(0, 4)).tabla[0];
  const fotos = st.recuerdos.slice(0, 4);
  const cuando = (d) => (d === 0 ? "¡Hoy!" : d === 1 ? "Mañana" : `En ${d} días`);

  const mesHoy = Number(hoy.slice(5, 7));
  const anioResumen = mesHoy === 12 ? hoy.slice(0, 4) : mesHoy === 1 ? String(Number(hoy.slice(0, 4)) - 1) : null;
  const hayResumen = anioResumen && st.partidos.some((p) => p.ganador && p.fecha.startsWith(anioResumen));
  // día jugado en los últimos 3 días en el que aún no votaste
  const hace3 = iso(new Date(Date.now() - 3 * 864e5));
  const pendienteVoto = st.extras && st.yo ? diasDePadel().filter((f) => f >= hace3).find((f) => !mejorDelDia(f).mio) : null;
  return `
    ${pendienteVoto ? `<button class="bannerVoto" data-mvp="${pendienteVoto}">⭐ <b>Vota al mejor jugador ${pendienteVoto === hoy ? "de hoy" : "de " + fechaLarga(pendienteVoto).toLowerCase()}</b><span>Votar →</span></button>` : ""}
    ${hayResumen ? `<button class="bannerResumen" data-resumen="${anioResumen}">✨ <b>Ya está el Resumen ${anioResumen}</b><span>Toca para verlo →</span></button>` : ""}
    <section class="portada ${portada ? "conImagen" : ""}" ${portada ? `style="background-image:url('${esc(portada)}')"` : ""}>
      <div class="portadaTexto">
        <h2>${esc(ini?.titulo || "¡Bienvenidos, Pendejos!")}</h2>
        ${ini?.mensaje ? `<p>${esc(ini.mensaje).replace(/\n/g, "<br>")}</p>` : ""}
      </div>
      ${st.esAdmin ? `<button class="btn chico" id="editarPortada">✏️ Editar</button>` : ""}
    </section>

    ${C.grupoWhatsApp ? `<a class="btn wa ancho irGrupo" href="${esc(C.grupoWhatsApp)}" target="_blank" rel="noopener">💬 Ir al grupo de WhatsApp</a>` : ""}
    ${tarjetaProximoPadel()}
    ${tarjetaNavidad()}
    <div class="fraseDia"><small>✨ FRASE DEL DÍA</small><p>${esc(fraseDelDia())}</p></div>
    ${tarjetaPregunta()}
    <div class="widgets">
      <button class="widget" data-tab-ir="calendario" ${prox ? `data-fecha="${prox.fecha}"` : ""}>
        <small>Próximo plan</small>
        <b>${prox ? `${TIPOS[tipoDe(prox)].ico} ${esc(tituloEvento(prox))}` : "Sin agendar"}</b>
        <span>${prox ? `${fechaLarga(prox.fecha).split(" ").slice(0, 2).join(" ")}${st.extras ? ` · 🙋 ${vanA(prox).length}${esPadel(prox) ? "/4" : ""}` : ""}` : "Agenda algo 📅"}</span>
      </button>
      <button class="widget" data-tab-ir="amigos">
        <small>Próximo cumple</small>
        <b>${cumple ? esc(cumple.a.nombre) : "—"}</b>
        <span>${cumple ? `🎂 ${cuando(cumple.d)}` : "Agrega fechas"}</span>
      </button>
      <button class="widget oscuro" data-tab-ir="ranking">
        <small>Líder ${hoy.slice(0, 4)}</small>
        <b>${lider ? esc(nombre(lider.id)) : "—"}</b>
        <span>${lider ? `🏆 ${lider.g} victoria${lider.g === 1 ? "" : "s"}` : "Sin resultados aún"}</span>
      </button>
    </div>

    <section class="tarjeta">
      <div class="mesNav">
        <h2>🤪 Pendejaditas</h2>
        ${st.esAdmin ? `<button class="btn primario" id="nuevaPub">+ Publicar</button>` : ""}
      </div>
      ${st.publicaciones.length ? st.publicaciones.map((x) => `
        <article class="pub">
          ${x.imagen_ruta && st.urls[x.imagen_ruta] ? `<img src="${esc(st.urls[x.imagen_ruta])}" alt="">` : ""}
          ${x.texto ? `<p>${esc(x.texto).replace(/\n/g, "<br>")}</p>` : ""}
          ${st.extras ? barraReacciones("pub", x.id) : ""}
          <div class="pubPie">
            <small>${x.fijada ? "📌 Fijada · " : ""}${fechaCorta(x.creado_en.slice(0, 10))}</small>
            ${st.esAdmin ? `<button class="enlace" data-pub="${x.id}">Editar</button>` : ""}
          </div>
        </article>`).join("")
        : `<p class="vacio">${st.esAdmin ? "Publica avisos, fotos del grupo o lo que quieras." : "Todavía no hay publicaciones."}</p>`}
    </section>

    ${tarjetaChismes()}
    ${fotos.length ? `<section class="tarjeta">
      <div class="mesNav"><h2>📸 Momentos</h2><button class="enlace" data-tab-ir="recuerdos">Ver todos</button></div>
      <div class="galeria cuatro">${fotos.map((r) => `<button class="foto mini" data-id="${r.id}"><img loading="lazy" src="${esc(st.urls[r.ruta] || "")}" alt=""></button>`).join("")}</div>
    </section>` : ""}`;
}

async function subirImagen(file, carpeta, max = 1600) {
  const blob = await comprimir(file, max);
  const ruta = `${carpeta}/${crypto.randomUUID()}.jpg`;
  const up = await sb.storage.from(BUCKET).upload(ruta, blob, { contentType: "image/jpeg" });
  if (up.error) throw up.error;
  return ruta;
}

function formPortada() {
  const ini = st.inicio || {};
  let quitar = false;
  const v = hoja(`
    <h3>Editar portada</h3>
    <form id="fPortada" class="form">
      <label>Título<input name="titulo" value="${esc(ini.titulo)}" placeholder="¡Bienvenidos, Pendejos!"></label>
      <label>Mensaje<textarea name="mensaje" rows="3" placeholder="Avisos, frase del mes…">${esc(ini.mensaje)}</textarea></label>
      <label>Foto de portada<input name="foto" type="file" accept="image/*"></label>
      ${ini.portada_ruta ? `<button type="button" class="enlace izq" id="quitarFoto">Quitar foto actual</button>` : ""}
      <div class="botones">
        <button type="button" class="btn" id="cancelar">Cancelar</button>
        <button type="submit" class="btn primario">Guardar</button>
      </div>
    </form>`);
  $("#cancelar", v).onclick = cerrarHoja;
  $("#quitarFoto", v)?.addEventListener("click", (e) => { quitar = true; e.target.textContent = "Se quitará al guardar ✓"; });
  $("#fPortada", v).onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const btn = ev.target.querySelector("[type=submit]");
    btn.disabled = true; btn.textContent = "Guardando…";
    try {
      const datos = { titulo: f.get("titulo").trim() || null, mensaje: f.get("mensaje").trim() || null, actualizado_en: new Date().toISOString() };
      const archivo = f.get("foto");
      if (archivo && archivo.size) datos.portada_ruta = await subirImagen(archivo, "inicio");
      else if (quitar) datos.portada_ruta = null;
      const { error: e } = await sb.from("inicio").update(datos).eq("id", 1);
      if (e) throw e;
      if (ini.portada_ruta && "portada_ruta" in datos) await sb.storage.from(BUCKET).remove([ini.portada_ruta]);
      cerrarHoja(); toast("Portada actualizada ✨"); cargarTodo();
    } catch (e) { btn.disabled = false; btn.textContent = "Guardar"; error(e); }
  };
}

function formPublicacion(x) {
  const nueva = !x;
  const v = hoja(`
    <h3>${nueva ? "Nueva publicación" : "Editar publicación"}</h3>
    <form id="fPub" class="form">
      <label>Texto<textarea name="texto" rows="4" placeholder="Este sábado torneo relámpago 🔥">${esc(x?.texto)}</textarea></label>
      <label>Imagen (opcional)<input name="foto" type="file" accept="image/*"></label>
      <label class="check"><input type="checkbox" name="fijada" ${x?.fijada ? "checked" : ""}> 📌 Fijar arriba</label>
      <label class="check"><input type="checkbox" name="avisar" ${nueva ? "checked" : ""}> 📣 Avisar a todos con notificación</label>
      <div class="botones">
        ${nueva ? "" : `<button type="button" class="btn peligro" id="borrar">Borrar</button>`}
        <button type="button" class="btn" id="cancelar">Cancelar</button>
        <button type="submit" class="btn primario">${nueva ? "Publicar" : "Guardar"}</button>
      </div>
    </form>`);
  $("#cancelar", v).onclick = cerrarHoja;
  if (!nueva) $("#borrar", v).onclick = async () => {
    if (!confirm("¿Borrar esta publicación?")) return;
    const { error: e } = await sb.from("publicaciones").delete().eq("id", x.id);
    if (e) return error(e);
    if (x.imagen_ruta) await sb.storage.from(BUCKET).remove([x.imagen_ruta]);
    cerrarHoja(); toast("Publicación borrada"); cargarTodo();
  };
  $("#fPub", v).onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const archivo = f.get("foto");
    const texto = f.get("texto").trim();
    if (!texto && !(archivo && archivo.size) && !x?.imagen_ruta) return toast("Escribe algo o agrega una imagen");
    const btn = ev.target.querySelector("[type=submit]");
    btn.disabled = true; btn.textContent = "Guardando…";
    try {
      const datos = { texto: texto || null, fijada: !!f.get("fijada") };
      if (archivo && archivo.size) datos.imagen_ruta = await subirImagen(archivo, "inicio");
      const { error: e } = nueva ? await sb.from("publicaciones").insert(datos) : await sb.from("publicaciones").update(datos).eq("id", x.id);
      if (e) throw e;
      if (!nueva && x.imagen_ruta && datos.imagen_ruta) await sb.storage.from(BUCKET).remove([x.imagen_ruta]);
      if (f.get("avisar") && texto) await enviarMensaje("🤪 Nueva pendejadita", texto);
      cerrarHoja(); if (!f.get("avisar")) toast(nueva ? "¡Publicado! 📣" : "Guardado"); cargarTodo();
    } catch (e) { btn.disabled = false; btn.textContent = nueva ? "Publicar" : "Guardar"; error(e); }
  };
}

// ---------- Recuerdos ----------
function vistaRecuerdos() {
  return `
    <section class="tarjeta">
      <div class="mesNav">
        <h2>Momentos</h2>
        <label class="btn primario">+ Subir fotos<input id="subir" type="file" accept="image/*" multiple hidden></label>
      </div>
      ${st.recuerdos.length ? `<div class="galeria">
        ${st.recuerdos.map((r) => `<button class="foto" data-id="${r.id}"><img loading="lazy" src="${esc(st.urls[r.ruta] || "")}" alt="${esc(r.descripcion)}"></button>`).join("")}
      </div>` : `<p class="vacio">Aún no hay momentos. ¡Suban la primera foto!</p>`}
    </section>`;
}

async function comprimir(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.82));
  } finally { URL.revokeObjectURL(url); }
}

function formFotos(files, partidoPre = null) {
  const jugados = [...st.partidos].filter((p) => p.fecha <= hoyISO()).reverse().slice(0, 30);
  const v = hoja(`
    <h3>Subir ${files.length} foto${files.length > 1 ? "s" : ""}</h3>
    <form id="fFotos" class="form">
      <label>Descripción (opcional)<input name="desc" placeholder="Final épica del domingo"></label>
      <label>Fecha<input name="fecha" type="date" value="${(partidoPre && st.partidos.find((x) => x.id === partidoPre)?.fecha) || hoyISO()}" required></label>
      <label>Evento (opcional)<select name="partido"><option value="">—</option>
        ${jugados.map((p) => `<option value="${p.id}" ${p.id === partidoPre ? "selected" : ""}>${fechaCorta(p.fecha)} · ${TIPOS[tipoDe(p)].ico} ${esPadel(p) ? `${equipo(p.equipo_a)} vs ${equipo(p.equipo_b)}` : esc(tituloEvento(p))}</option>`).join("")}
      </select></label>
      <div class="botones">
        <button type="button" class="btn" id="cancelar">Cancelar</button>
        <button type="submit" class="btn primario">Subir</button>
      </div>
    </form>`);
  $("#cancelar", v).onclick = cerrarHoja;
  $("#fFotos", v).onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const btn = ev.target.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      let n = 0;
      for (const file of files) {
        btn.textContent = `Subiendo ${++n}/${files.length}…`;
        const ruta = await subirImagen(file, f.get("fecha").slice(0, 4));
        const ins = await sb.from("recuerdos").insert({
          ruta, descripcion: f.get("desc").trim() || null, fecha: f.get("fecha"), partido_id: f.get("partido") || null,
        });
        if (ins.error) throw ins.error;
      }
      cerrarHoja(); toast("¡Fotos subidas! 📸"); cargarTodo();
    } catch (e) { btn.disabled = false; btn.textContent = "Subir"; error(e); }
  };
}

function verFoto(r) {
  if (!r) return;
  const p = r.partido_id && st.partidos.find((x) => x.id === r.partido_id);
  const v = hoja(`
    <img class="grande" src="${esc(st.urls[r.ruta] || "")}" alt="">
    ${r.descripcion ? `<p><b>${esc(r.descripcion)}</b></p>` : ""}
    <p class="sub">${r.fecha ? fechaLarga(r.fecha) : ""}${p ? ` · ${esPadel(p) ? `${equipo(p.equipo_a)} vs ${equipo(p.equipo_b)}` : esc(tituloEvento(p))}` : ""}</p>
    ${st.extras ? barraReacciones("foto", r.id, false) + bloqueComentarios("foto", r.id) : ""}
    <div class="botones">
      <button class="btn peligro" id="borrar">Borrar</button>
      <a class="btn" href="${esc(st.urls[r.ruta] || "")}" target="_blank" rel="noopener">Abrir</a>
      <button class="btn primario" id="cerrar">Cerrar</button>
    </div>`, () => verFoto(st.recuerdos.find((x) => x.id === r.id)));
  $("#cerrar", v).onclick = cerrarHoja;
  if (st.extras) enlazarComentarios(v, "foto", r.id);
  $("#borrar", v).onclick = async () => {
    if (!confirm("¿Borrar esta foto para todos?")) return;
    const a = await sb.storage.from(BUCKET).remove([r.ruta]);
    if (a.error) return error(a.error);
    const b = await sb.from("recuerdos").delete().eq("id", r.id);
    if (b.error) return error(b.error);
    cerrarHoja(); toast("Foto borrada"); cargarTodo();
  };
}

// ---------- Amigos y cumpleaños ----------
function vistaAmigos() {
  const conFecha = st.amigos.filter((a) => a.cumple_mes).map((a) => ({ a, d: diasHastaCumple(a) })).sort((x, y) => x.d - y.d);
  const falta = (d) => (d === 0 ? "¡Hoy! 🎉" : d === 1 ? "Mañana" : `en ${d} días`);
  return `
    ${conFecha.length ? `<section class="tarjeta"><h3>Próximos cumpleaños</h3>
      ${conFecha.slice(0, 5).map(({ a, d }) => `<div class="fila cumple ${d === 0 ? "hoyC" : ""}">🎂 <b>${esc(a.nombre)}</b> · ${textoCumple(a)} <span class="pill">${falta(d)}</span>${d === 0 ? `<div style="margin-top:6px">${botonWA(`🎉 ¡Feliz cumple, ${a.nombre}! 🎂 Que lo disfrutes mucho. Te queremos, aunque seas un pendejo 😂🎾`, "📲 Felicitar por WhatsApp")}</div>` : ""}</div>`).join("")}
    </section>` : ""}
    <section class="tarjeta">
      <div class="mesNav">
        <h2>El grupo (${st.amigos.length})</h2>
        <div class="rsvpBtns">${botonWA(`🎾 ¡Ya tenemos app, Pendejos!\nPartidos, planes, cumples, fotos y la votación del mejor jugador.\n\n👉 ${LINK_APP}\n1. Toca tu nombre y pon el código del grupo (te lo paso por privado 😉)\n2. Agrégala a inicio: Compartir → "Agregar a inicio"\n3. Activa la 🔔 para recibir avisos`, "📲 Invitar")}<button class="btn primario" id="nuevoAmigo">+ Agregar</button></div>
      </div>
      ${st.extras && !st.yo ? `<button class="aviso clic ancho" id="soyYo">👋 ¿Quién eres tú? Toca para vincular tu cuenta</button>` : ""}
      ${st.amigos.length ? st.amigos.map((a) => `<button class="fila clic filaPerfil" data-amigo="${a.id}">${avatar(a)}<span><b>${esc(a.nombre)}</b>${a.id === st.yo ? ` <span class="tu">Tú</span>` : ""}${a.apodo ? ` <small>“${esc(a.apodo)}”</small>` : ""}<br><small>${a.posicion ? POSICIONES[a.posicion] + " · " : ""}🎂 ${textoCumple(a)}</small></span></button>`).join("")
        : `<p class="vacio">Agrega a los del grupo con su cumpleaños. Así podrás elegir las parejas de cada partido y les llegará el aviso de cumpleaños.</p>`}
    </section>`;
}

function formAmigo(a) {
  const nuevo = !a;
  const v = hoja(`
    <h3>${nuevo ? "Nuevo amigo" : "Editar perfil"}</h3>
    <form id="fAmigo" class="form">
      ${nuevo ? "" : `<div class="fotoEditar">${avatar(a, "grande")}<label class="btn">📷 Cambiar foto<input name="foto" type="file" accept="image/*" hidden></label></div>`}
      <div class="dos">
        <label>Nombre<input name="nombre" required value="${esc(a?.nombre)}" placeholder="Ej. Caro"></label>
        <label>Apodo<input name="apodo" value="${esc(a?.apodo)}" placeholder="El Muro, La Bandeja…"></label>
      </div>
      <div class="dos">
        <label>Día del cumple<select name="dia"><option value="">—</option>
          ${Array.from({ length: 31 }, (_, i) => `<option ${a?.cumple_dia === i + 1 ? "selected" : ""}>${i + 1}</option>`).join("")}
        </select></label>
        <label>Mes<select name="mes"><option value="">—</option>
          ${MESES.map((m, i) => `<option value="${i + 1}" ${a?.cumple_mes === i + 1 ? "selected" : ""}>${m}</option>`).join("")}
        </select></label>
      </div>
      <label>¿De qué lado juega?<select name="posicion"><option value="">—</option>
        ${Object.entries(POSICIONES).map(([k, t]) => `<option value="${k}" ${a?.posicion === k ? "selected" : ""}>${t}</option>`).join("")}
      </select></label>
      <label>Pala<input name="pala" value="${esc(a?.pala)}" placeholder="Bullpadel Vertex, la del Decathlon…"></label>
      <label>Frase / lema<input name="frase" maxlength="120" value="${esc(a?.frase)}" placeholder="Esa iba fuera."></label>
      <div class="botones">
        ${!nuevo && st.esAdmin && a.id !== st.yo ? `<button type="button" class="btn peligro" id="borrar">Borrar</button>` : ""}
        <button type="button" class="btn" id="cancelar">Cancelar</button>
        <button type="submit" class="btn primario">Guardar</button>
      </div>
    </form>`);
  $("#cancelar", v).onclick = cerrarHoja;
  if ($("#borrar", v)) $("#borrar", v).onclick = async () => {
    if (!confirm(`¿Borrar a ${a.nombre}? Sus partidos se quedan, pero sin su nombre.`)) return;
    const { error: e } = await sb.from("amigos").delete().eq("id", a.id);
    if (e) return error(e);
    cerrarHoja(); cargarTodo();
  };
  $("#fAmigo", v).onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const dia = Number(f.get("dia")) || null, mes = Number(f.get("mes")) || null;
    if (!!dia !== !!mes) return toast("Elige día y mes del cumpleaños (o deja los dos vacíos)");
    if (dia && dia > new Date(2024, mes, 0).getDate()) return toast("Esa fecha no existe");
    const datos = {
      nombre: f.get("nombre").trim(), cumple_dia: dia, cumple_mes: mes,
      apodo: f.get("apodo").trim() || null, posicion: f.get("posicion") || null,
      pala: f.get("pala").trim() || null, frase: f.get("frase").trim() || null,
    };
    const archivo = f.get("foto");
    const btn = ev.target.querySelector("[type=submit]");
    btn.disabled = true; btn.textContent = "Guardando…";
    try {
      if (archivo && archivo.size) datos.foto_ruta = await subirImagen(archivo, "perfiles", 600);
    } catch (e2) { btn.disabled = false; btn.textContent = "Guardar"; return error(e2); }
    const { error: e } = nuevo ? await sb.from("amigos").insert(datos) : await sb.from("amigos").update(datos).eq("id", a.id);
    if (e) return error(e);
    if (!nuevo && a.foto_ruta && datos.foto_ruta) await sb.storage.from(BUCKET).remove([a.foto_ruta]);
    cerrarHoja(); toast("Guardado"); cargarTodo();
  };
  $("[name=foto]", v)?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) $(".fotoEditar .avatar", v).outerHTML = `<img class="avatar grande" src="${URL.createObjectURL(file)}" alt="">`;
  });
}

// ---------- Perfil ----------
const POSICIONES = { drive: "↗️ Drive", reves: "↖️ Revés", ambos: "↔️ Los dos lados" };

function avatar(a, tam = "") {
  const url = a?.foto_ruta && st.urls[a.foto_ruta];
  if (url) return `<img class="avatar ${tam}" src="${esc(url)}" alt="">`;
  const ini = (a?.nombre || "?").trim().slice(0, 1).toUpperCase();
  return `<span class="avatar ${tam} inicial">${esc(ini)}</span>`;
}

function verPerfil(id) {
  const a = st.amigos.find((x) => x.id === id);
  if (!a) return;
  const { tabla } = calcularRanking(hoyISO().slice(0, 4));
  const r = calcularRanking("todo").tabla.find((x) => x.id === id) || { g: 0, j: 0, pct: 0 };
  const puesto = tabla.findIndex((x) => x.id === id);
  const dias = titulosDelDia(() => true).find(([x]) => x === id)?.[1] || 0;
  const racha = estadisticasParejas("todo").listaRachas.find((x) => x.id === id);
  const fue = st.asistencias.filter((x) => x.amigo_id === id && x.estado === "voy").length;
  const puedeEditar = id === st.yo || st.esAdmin;
  const d = diasHastaCumple(a);

  const v = hoja(`
    <div class="perfil">
      ${avatar(a, "enorme")}
      <h2>${esc(a.nombre)}${id === st.yo ? ` <span class="tu">Tú</span>` : ""}</h2>
      ${a.apodo ? `<p class="apodo">“${esc(a.apodo)}”</p>` : ""}
      <div class="chips centrados">
        ${a.posicion ? `<span class="chip on">${POSICIONES[a.posicion]}</span>` : ""}
        ${a.pala ? `<span class="chip">🏓 ${esc(a.pala)}</span>` : ""}
        ${a.cumple_mes ? `<span class="chip">🎂 ${textoCumple(a)}${d === 0 ? " · ¡hoy!" : d < 30 ? ` · en ${d} días` : ""}</span>` : ""}
      </div>
      ${a.frase ? `<blockquote>${esc(a.frase)}</blockquote>` : ""}
      ${a.foto_padel_ruta && st.urls[a.foto_padel_ruta] ? `<img class="fotoPadel" src="${esc(st.urls[a.foto_padel_ruta])}" alt="">` : ""}
    </div>
    <div class="stats">
      <div><b>${r.g}</b><small>Victorias</small></div>
      <div><b>${r.j}</b><small>Partidos</small></div>
      <div><b>${r.j ? r.pct + "%" : "—"}</b><small>Ganados</small></div>
      <div><b>${puesto >= 0 ? "#" + (puesto + 1) : "—"}</b><small>Ranking ${hoyISO().slice(0, 4)}</small></div>
      <div><b>${dias}</b><small>⭐ Mejor del día</small></div>
      <div><b>${racha?.mejor || 0}</b><small>🔥 Mejor racha</small></div>
      <div><b>${fue}</b><small>🙋 Planes</small></div>
    </div>

    <div class="botones">
      ${puedeEditar ? `<button class="btn" id="editar">✏️ Editar perfil</button>` : ""}
      <button class="btn primario" id="cerrar">Cerrar</button>
    </div>`, () => verPerfil(id));
  $("#cerrar", v).onclick = cerrarHoja;
  $("#editar", v)?.addEventListener("click", () => formAmigo(a));
}

// ---------- Notificaciones ----------
const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const instalada = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function urlB64(b64) {
  const p = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function abrirAvisos() {
  const soporta = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const activo = soporta && Notification.permission === "granted";
  let cuerpo;
  if (esIOS && !instalada) {
    cuerpo = `<p>En iPhone, las notificaciones solo funcionan si primero instalas la app:</p>
      <ol><li>Abre esta página en <b>Safari</b>.</li><li>Toca <b>Compartir</b> (el cuadro con la flecha).</li><li>Elige <b>Agregar a inicio</b>.</li><li>Abre la app desde el ícono nuevo y vuelve a tocar 🔔.</li></ol>`;
  } else if (!soporta) {
    cuerpo = `<p>Este navegador no permite notificaciones. Prueba con Chrome (Android) o Safari (iPhone, instalando la app).</p>`;
  } else {
    cuerpo = `<p>Recibe un aviso el día antes y el día del partido, y cuando alguien cumpla años.</p>
      <button class="btn primario ancho" id="activar">${activo ? "Volver a registrar este celular" : "Activar notificaciones"}</button>`;
  }
  const v = hoja(`
    <h3>🔔 Notificaciones</h3>
    ${cuerpo}
    ${!instalada && !esIOS ? `<p class="sub">Tip: en Android, desde el menú ⋮ de Chrome elige <b>Instalar app</b> o <b>Agregar a pantalla principal</b>.</p>` : ""}
    ${st.esAdmin ? `<form id="fMsg" class="form tarjeta msgPush">
      <b>📣 Mandar un mensaje a todos</b>
      <label>Título (opcional)<input name="titulo" maxlength="80" placeholder="📣 Pendejos"></label>
      <label>Mensaje<textarea name="mensaje" rows="3" maxlength="300" required placeholder="Mañana no hay pádel, llueve 🌧️"></textarea></label>
      <button class="btn primario">Enviar notificación</button>
    </form>
    <button class="btn ancho" id="probarPush">Mandar notificación de prueba</button>` : ""}
    <div class="botones"><button class="btn" id="cerrar">Cerrar</button></div>`);
  $("#cerrar", v).onclick = cerrarHoja;
  $("#fMsg", v)?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const btn = ev.target.querySelector("button");
    btn.disabled = true; btn.textContent = "Enviando…";
    const r = await enviarMensaje(f.get("titulo"), f.get("mensaje"));
    btn.disabled = false; btn.textContent = "Enviar notificación";
    if (r) ev.target.reset();
  });
  $("#probarPush", v)?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    const r = await sb.functions.invoke("avisos", { body: { modo: "prueba" } });
    e.target.disabled = false;
    if (r.error) return toast("No se pudo enviar");
    toast(r.data.celulares ? `Enviada a ${r.data.celulares} celular(es) 📣` : "Nadie ha activado las notificaciones todavía");
  });
  const b = $("#activar", v);
  if (b) b.onclick = activarAvisos;
}

async function enviarMensaje(titulo, mensaje) {
  mensaje = (mensaje || "").trim();
  if (!mensaje) { toast("Escribe el mensaje"); return false; }
  const r = await sb.functions.invoke("avisos", { body: { modo: "personalizado", titulo: (titulo || "").trim(), mensaje } });
  if (r.error) { toast("No se pudo enviar"); return false; }
  toast(r.data.celulares ? `📣 Enviado a ${r.data.celulares} celular(es)` : "Nadie ha activado las notificaciones todavía");
  return true;
}

async function activarAvisos() {
  try {
    const permiso = await Notification.requestPermission();
    if (permiso !== "granted") return toast("No diste permiso. Puedes activarlo en los ajustes del celular.");
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(C.vapidPublicKey) }));
    const j = sub.toJSON();
    const { error: e } = await sb.from("suscripciones_push").upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
    if (e) throw e;
    await reg.showNotification("Notificaciones activadas 🎾", { body: "Te avisaremos de partidos y cumpleaños.", icon: "icons/p-192.png" });
    cerrarHoja();
    toast("¡Listo! Notificaciones activadas");
  } catch (e) { error(e); }
}

// =============================================================
//  FUNCIONES EXTRA: ¿Quién va?, MVP, parejas y rachas, torneos,
//  comentarios y reacciones, Resumen del año
// =============================================================

const EMOJIS = ["🔥", "😂", "👏", "❤️"];

function necesitoYo() {
  if (st.yo) return true;
  quienEres();
  return false;
}

// ---------- ¿Quién eres? (vincula la cuenta con un amigo) ----------
function quienEres() {
  const libres = st.amigos.filter((a) => !a.usuario);
  const v = hoja(`
    <h3>👋 ¿Quién eres tú?</h3>
    <p class="sub">Así la app sabe quién confirma, vota y comenta. Solo se hace una vez.</p>
    ${libres.length ? `<div class="chips">${libres.map((a) => `<button class="chip" data-yo="${a.id}">${esc(a.nombre)}</button>`).join("")}</div>` : ""}
    <form id="fYo" class="form" style="margin-top:14px">
      <label>${libres.length ? "¿No estás en la lista? Escribe tu nombre" : "Tu nombre"}<input name="nombre" placeholder="Tu nombre"></label>
      <div class="botones">
        <button type="button" class="btn" id="cancelar">Ahora no</button>
        <button type="submit" class="btn primario">Agregarme</button>
      </div>
    </form>`);
  $("#cancelar", v).onclick = cerrarHoja;
  v.querySelectorAll("[data-yo]").forEach((b) => (b.onclick = async () => {
    const { data, error: e } = await sb.from("amigos").update({ usuario: st.usuario.id }).eq("id", b.dataset.yo).is("usuario", null).select();
    if (e) return error(e);
    if (!data.length) return toast("Esa persona ya está vinculada a otra cuenta");
    cerrarHoja(); toast(`¡Hola, ${data[0].nombre}! 👋`); cargarTodo();
  }));
  $("#fYo", v).onsubmit = async (ev) => {
    ev.preventDefault();
    const nombreNuevo = new FormData(ev.target).get("nombre").trim();
    if (!nombreNuevo) return toast("Escribe tu nombre");
    const { error: e } = await sb.from("amigos").insert({ nombre: nombreNuevo, usuario: st.usuario.id });
    if (e) return error(e);
    cerrarHoja(); toast(`¡Bienvenido, ${nombreNuevo}! Agrega tu cumple en 🎂 Cumple`); cargarTodo();
  };
}

// ---------- WhatsApp ----------
const LINK_APP = "https://simonakolvek-create.github.io/Pendejos/";
const botonWA = (texto, etiqueta = "📲 WhatsApp", clase = "") =>
  `<button type="button" class="btn chico wa ${clase}" data-wa="${esc(encodeURIComponent(texto))}">${etiqueta}</button>`;
function abrirWA(textoCodificado) {
  window.open("https://wa.me/?text=" + textoCodificado, "_blank", "noopener");
}
function textoPlan(p) {
  const t = TIPOS[tipoDe(p)];
  const van = vanA(p);
  const cuando = `${fechaLarga(p.fecha)}${p.hora ? (p.hora_fin ? " de " + hora(p.hora) + " a " + hora(p.hora_fin) : " a las " + hora(p.hora)) : ""}${p.lugar ? " en " + p.lugar : ""}`;
  const quien = esPadel(p)
    ? (van.length >= 4 ? `✅ Ya somos 4: ${van.map(nombre).join(", ")}` : `🙋 Van ${van.length}/4${van.length ? ": " + van.map(nombre).join(", ") : ""}. ¿Quién se apunta?`)
    : (van.length ? `🙋 Van: ${van.map(nombre).join(", ")}. ¿Quién más?` : "¿Quién se apunta? 🙋");
  return `${t.ico} ${esPadel(p) ? "Pádel" : tituloEvento(p)} · ${cuando}\n${quien}\n\n👉 Confirma en la app: ${LINK_APP}`;
}

// ---------- ¿Quién va? ----------
const vanA = (p) => st.asistencias.filter((x) => x.partido_id === p.id && x.estado === "voy").map((x) => x.amigo_id);
const noVanA = (p) => st.asistencias.filter((x) => x.partido_id === p.id && x.estado === "no").map((x) => x.amigo_id);

function filaQuienVa(p) {
  const van = vanA(p), no = noVanA(p);
  const mio = st.asistencias.find((x) => x.partido_id === p.id && x.amigo_id === st.yo)?.estado;
  const padel = esPadel(p);
  const lleno = padel && van.length >= 4;
  return `<div class="rsvp">
    <div class="rsvpTxt">
      <b class="${lleno ? "lleno" : ""}">${lleno ? "✅ ¡Ya son 4!" : padel ? `🙋 Van ${van.length}/4` : `🙋 Van ${van.length}`}</b>
      ${van.length ? `<small>${van.map((i) => esc(nombre(i))).join(", ")}</small>` : `<small>Nadie ha confirmado</small>`}
      ${no.length ? `<small class="no">No pueden: ${no.map((i) => esc(nombre(i))).join(", ")}</small>` : ""}
    </div>
    <div class="rsvpBtns">
      <button class="btn chico ${mio === "voy" ? "primario" : ""}" data-rsvp="${p.id}|voy">Voy</button>
      <button class="btn chico ${mio === "no" ? "negro" : ""}" data-rsvp="${p.id}|no">No puedo</button>
      ${botonWA(textoPlan(p), "📲")}
    </div>
  </div>`;
}

async function marcarAsistencia(partidoId, estado) {
  if (!necesitoYo()) return;
  const actual = st.asistencias.find((x) => x.partido_id === partidoId && x.amigo_id === st.yo);
  const q = actual?.estado === estado
    ? sb.from("asistencias").delete().eq("partido_id", partidoId).eq("amigo_id", st.yo)
    : sb.from("asistencias").upsert({ partido_id: partidoId, amigo_id: st.yo, estado });
  const { error: e } = await q;
  if (e) return error(e);
  // si alguien se baja y ya no son 4, se vuelve a avisar cuando se complete
  const p = st.partidos.find((x) => x.id === partidoId);
  if (p?.aviso_completo && estado === "no") await sb.from("partidos").update({ aviso_completo: false }).eq("id", partidoId);
  toast(actual?.estado === estado ? "Quitado" : estado === "voy" ? "¡Apuntado! 🎾" : "Ok, será la próxima");
  cargarTodo();
}

// ---------- Mejor jugador del día ----------
const jugadoresDe = (p) => [...(p.equipo_a || []), ...(p.equipo_b || [])];
// quién jugó ese día (en partidos con resultado; si no hay parejas, los que dijeron "voy")
// días en que hubo pádel (aunque no se haya apuntado quién ganó)
const diasDePadel = () => [...new Set(st.partidos.filter((p) => esPadel(p) && p.fecha <= hoyISO()).map((p) => p.fecha))].sort().reverse();

function jugaronDia(fecha) {
  const ps = st.partidos.filter((p) => p.fecha === fecha && esPadel(p));
  const ids = new Set();
  // 1º los que preparó la admin; si no, las parejas; si no, los que dijeron "voy"
  const elegidos = ps.flatMap((p) => p.jugadores || []);
  if (elegidos.length) return [...new Set(elegidos)];
  for (const p of ps) { const j = jugadoresDe(p); (j.length ? j : vanA(p)).forEach((id) => ids.add(id)); }
  return [...ids];
}

// La admin elige quiénes jugaron ese día (solo ellos salen en la votación)
function elegirJugadores(fecha) {
  const p = st.partidos.find((x) => x.fecha === fecha && esPadel(x));
  if (!p) return;
  const sel = new Set(jugaronDia(fecha));
  const v = hoja(`
    <h3>👥 ¿Quiénes jugaron?</h3>
    <p class="sub">${fechaLarga(fecha)} · solo ellos saldrán en la votación</p>
    <div class="chips grandes" id="jug"></div>
    <div class="botones">
      <button class="btn" id="cancelar">Cancelar</button>
      <button class="btn primario" id="guardar">Guardar</button>
    </div>`);
  const pintarJug = () => {
    $("#jug", v).innerHTML = st.amigos.map((a) => `<button class="chip ${sel.has(a.id) ? "on" : ""}" data-id="${a.id}">${esc(a.nombre)}</button>`).join("");
    v.querySelectorAll("#jug .chip").forEach((b) => (b.onclick = () => { sel.has(b.dataset.id) ? sel.delete(b.dataset.id) : sel.add(b.dataset.id); pintarJug(); }));
  };
  pintarJug();
  $("#cancelar", v).onclick = cerrarHoja;
  $("#guardar", v).onclick = async () => {
    if (sel.size < 2) return toast("Elige al menos 2 jugadores");
    const { error: e } = await sb.from("partidos").update({ jugadores: [...sel] }).eq("id", p.id);
    if (e) return error(e);
    cerrarHoja(); toast(`Listo: ${sel.size} jugadores en la votación ⭐`); cargarTodo();
  };
}
const botonJugadores = (fecha) => (st.esAdmin ? `<button class="btn chico" data-jugadores="${fecha}">👥 ${jugaronDia(fecha).length || "Elegir"}</button>` : "");

function mejorDelDia(fecha) {
  const votos = st.votos.filter((v) => v.fecha === fecha);
  const cuenta = {};
  for (const v of votos) cuenta[v.votado] = (cuenta[v.votado] || 0) + 1;
  const max = Math.max(0, ...Object.values(cuenta));
  const ganadores = max ? Object.keys(cuenta).filter((id) => cuenta[id] === max) : [];
  return { total: votos.length, ganadores, n: max, mio: votos.find((v) => v.votante === st.yo)?.votado };
}

function bloqueMejorDia(fecha) {
  if (fecha > hoyISO() || !st.partidos.some((p) => p.fecha === fecha && esPadel(p))) return "";
  const m = mejorDelDia(fecha);
  const nombres = m.ganadores.map((id) => esc(nombre(id))).join(" y ");
  return `<div class="mejorDia">
    <div class="rsvpTxt">
      <small>⭐ MEJOR JUGADOR DEL DÍA</small>
      ${m.ganadores.length ? `<b>${m.ganadores.length > 1 ? "Empate: " : ""}${nombres}</b><small>${m.n} voto${m.n === 1 ? "" : "s"} · ${m.total} en total</small>` : `<b>Nadie ha votado todavía</b>`}
    </div>
    <div class="rsvpBtns">${botonJugadores(fecha)}${m.ganadores.length ? botonWA(`⭐ ${m.ganadores.length > 1 ? "Mejores jugadores" : "Mejor jugador"} del pádel (${fechaLarga(fecha).toLowerCase()}): ${m.ganadores.map(nombre).join(" y ")} 🏆\n${m.n} voto${m.n === 1 ? "" : "s"} de ${m.total}.\n\n¿Todavía no votas? 👉 ${LINK_APP}`, "📲") : ""}<button class="btn chico ${m.mio ? "" : "primario"}" data-mvp="${fecha}">${m.mio ? "Cambiar voto" : "Votar"}</button></div>
  </div>`;
}

function votarMVP(fecha) {
  if (!necesitoYo()) return;
  if (st.esAdmin && !jugaronDia(fecha).length) return elegirJugadores(fecha);
  let candidatos = jugaronDia(fecha).filter((id) => id !== st.yo);
  if (!candidatos.length) candidatos = st.amigos.map((a) => a.id).filter((id) => id !== st.yo);
  const mio = mejorDelDia(fecha).mio;
  const v = hoja(`
    <h3>⭐ ¿Quién fue el mejor del día?</h3>
    <p class="sub">${fechaLarga(fecha)} · no puedes votarte a ti</p>
    <div class="chips grandes">${candidatos.map((id) => `<button class="chip ${mio === id ? "on" : ""}" data-voto="${id}">${esc(nombre(id))}</button>`).join("")}</div>
    <div class="botones"><button class="btn" id="cerrar">Cerrar</button></div>`);
  $("#cerrar", v).onclick = cerrarHoja;
  v.querySelectorAll("[data-voto]").forEach((b) => (b.onclick = async () => {
    const { error: e } = await sb.from("votos_dia").upsert({ fecha, votante: st.yo, votado: b.dataset.voto });
    if (e) return error(e);
    cerrarHoja(); toast("¡Voto registrado! ⭐"); cargarTodo();
  }));
}

// ---------- Sección "Mejor jugador" en Ranking ----------
function seccionMejorJugador(anio) {
  const enAnio = (f) => anio === "todo" || f.startsWith(anio);
  const dias = diasDePadel().filter(enAnio);
  // tabla: días como mejor + votos recibidos
  const votos = {};
  for (const v of st.votos) if (enAnio(v.fecha)) votos[v.votado] = (votos[v.votado] || 0) + 1;
  const titulos = Object.fromEntries(titulosDelDia(enAnio));
  const ids = [...new Set([...Object.keys(votos), ...Object.keys(titulos)])];
  const tabla = ids.map((id) => ({ id, d: titulos[id] || 0, v: votos[id] || 0 }))
    .sort((a, b) => b.d - a.d || b.v - a.v);
  const medalla = (i) => ["🥇", "🥈", "🥉"][i] || `${i + 1}.`;

  return `<section class="tarjeta destacada">
    <div class="mesNav"><h2>⭐ Mejor jugador</h2></div>
    <p class="sub" style="margin-top:-4px">Después de cada día de pádel, voten quién jugó mejor.</p>
    ${tabla.length ? `<table class="tabla">
      <thead><tr><th></th><th>Jugador</th><th>Días ⭐</th><th>Votos</th></tr></thead>
      <tbody>${tabla.map((x, i) => `<tr><td>${medalla(i)}</td><td>${esc(nombre(x.id))}</td><td><b>${x.d}</b></td><td>${x.v}</td></tr>`).join("")}</tbody>
    </table>` : `<p class="vacio">Todavía no hay votos.</p>`}
    ${dias.length ? `<h4 class="subtitulo">Votación por día</h4>
      ${dias.slice(0, 10).map((f) => {
        const m = mejorDelDia(f);
        return `<div class="filaVoto">
          <div><small>${fechaLarga(f)}</small><br>${m.ganadores.length ? `⭐ <b>${m.ganadores.map((id) => esc(nombre(id))).join(" y ")}</b> <small>· ${m.n} voto${m.n === 1 ? "" : "s"} de ${m.total}</small>` : `<span class="sub">Sin votos todavía</span>`}</div>
          <div class="rsvpBtns">${botonJugadores(f)}<button class="btn chico ${m.mio ? "" : "primario"}" data-mvp="${f}">${m.mio ? "Cambiar" : "Votar"}</button></div>
        </div>`;
      }).join("")}` : ""}
  </section>`;
}

// cuántas veces fue cada uno el mejor del día (por mes y por año)
function titulosDelDia(filtro) {
  const fechas = [...new Set(st.votos.map((v) => v.fecha))].filter(filtro);
  const t = {};
  for (const f of fechas) for (const id of mejorDelDia(f).ganadores) t[id] = (t[id] || 0) + 1;
  return Object.entries(t).sort((a, b) => b[1] - a[1]);
}

function mvpPorMes(anio) {
  const meses = [...new Set(st.votos.map((v) => v.fecha.slice(0, 7)))]
    .filter((k) => anio === "todo" || k.startsWith(anio)).sort().reverse();
  return meses.map((k) => {
    const top = titulosDelDia((f) => f.startsWith(k));
    return top.length ? { k, id: top[0][0], n: top[0][1] } : null;
  }).filter(Boolean);
}

// ---------- Parejas y rachas ----------
function estadisticasParejas(anio) {
  const jugados = st.partidos.filter((p) => p.ganador && (anio === "todo" || p.fecha.startsWith(anio)));
  const parejas = new Map();
  for (const p of jugados) {
    for (const [eq, gano] of [[p.equipo_a, p.ganador === "A"], [p.equipo_b, p.ganador === "B"]]) {
      if (!eq || eq.length !== 2) continue;
      const k = [...eq].sort().join("|");
      const x = parejas.get(k) || { ids: k.split("|"), j: 0, g: 0 };
      x.j++; if (gano) x.g++;
      parejas.set(k, x);
    }
  }
  const tablaParejas = [...parejas.values()].map((x) => ({ ...x, pct: Math.round((x.g / x.j) * 100) }))
    .sort((a, b) => b.g - a.g || b.pct - a.pct);

  // rachas (en orden de fecha)
  const rachas = {};
  for (const p of jugados) {
    for (const [eq, gano] of [[p.equipo_a, p.ganador === "A"], [p.equipo_b, p.ganador === "B"]]) {
      for (const id of eq || []) {
        const r = (rachas[id] ||= { id, actual: 0, mejor: 0 });
        r.actual = gano ? r.actual + 1 : 0;
        r.mejor = Math.max(r.mejor, r.actual);
      }
    }
  }
  const listaRachas = Object.values(rachas).sort((a, b) => b.actual - a.actual || b.mejor - a.mejor);
  return { tablaParejas, listaRachas };
}

function seccionesExtraRanking(anio) {
  const { tablaParejas, listaRachas } = estadisticasParejas(anio);
  const mvps = st.extras ? mvpPorMes(anio).slice(0, 6) : [];
  const enFuego = listaRachas.filter((r) => r.actual >= 2);
  const mejorRacha = [...listaRachas].sort((a, b) => b.mejor - a.mejor)[0];
  const anioRes = anio === "todo" ? hoyISO().slice(0, 4) : anio;
  const mesNombre = (k) => `${MESES[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;

  return `
    ${st.partidos.some((p) => p.ganador && p.fecha.startsWith(anioRes)) ? `<button class="bannerResumen" data-resumen="${anioRes}">✨ <b>Resumen ${anioRes}</b><span>Tu año de pádel →</span></button>` : ""}



    ${tablaParejas.length ? `<section class="tarjeta"><h3>🤝 Parejas</h3>
      <table class="tabla parejas"><thead><tr><th>Pareja</th><th>Ganados</th><th>Jugados</th><th>%</th></tr></thead>
      <tbody>${tablaParejas.slice(0, 6).map((x, i) => `<tr><td>${i === 0 ? "👑 " : ""}${x.ids.map((id) => esc(nombre(id))).join(" y ")}</td><td><b>${x.g}</b></td><td>${x.j}</td><td>${x.pct}%</td></tr>`).join("")}</tbody></table>
    </section>` : ""}

    ${listaRachas.length ? `<section class="tarjeta"><h3>🔥 Rachas</h3>
      ${enFuego.length ? enFuego.map((r) => `<div class="fila">🔥 <b>${esc(nombre(r.id))}</b> lleva <b>${r.actual}</b> victorias seguidas</div>`).join("") : `<p class="vacio">Nadie está en racha ahora mismo.</p>`}
      ${mejorRacha?.mejor ? `<div class="fila"><small>Récord de racha: <b>${esc(nombre(mejorRacha.id))}</b> con ${mejorRacha.mejor} seguidas</small></div>` : ""}
    </section>` : ""}

    ${st.extras ? `<section class="tarjeta">
      <div class="mesNav"><h2>⚡ Torneos relámpago</h2><button class="btn primario" id="nuevoTorneo">+ Nuevo</button></div>
      ${st.torneos.length ? st.torneos.map((t) => {
        const c = campeonTorneo(t);
        return `<button class="fila clic" data-torneo="${t.id}"><b>${esc(t.nombre)}</b> <small>· ${fechaCorta(t.fecha)}</small><br><small>${c ? `🏆 ${c.map((id) => esc(nombre(id))).join(" y ")}` : "En juego…"}</small></button>`;
      }).join("") : `<p class="vacio">Elige a los que juegan, la app sortea las parejas y arma el cuadro.</p>`}
    </section>` : ""}`;
}

// ---------- Torneo relámpago ----------
function mezclar(lista) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const ranurasDe = (t) => t.datos.slots || t.datos.parejas.map((_, k) => k);

function campeonTorneo(t) {
  const r = t.datos.rondas;
  const g = r[r.length - 1][0];
  return g == null ? null : t.datos.parejas[g];
}

function formTorneo() {
  const elegidos = new Set();
  let parejas = null;
  const v = hoja(`
    <h3>⚡ Nuevo torneo relámpago</h3>
    <form id="fTorneo" class="form">
      <div class="dos">
        <label>Nombre<input name="nombre" value="Torneo relámpago" required></label>
        <label>Fecha<input name="fecha" type="date" value="${hoyISO()}" required></label>
      </div>
      <div class="equipo"><b>¿Quiénes juegan? (número par, mínimo 4)</b><div class="chips" id="jug"></div></div>
      <div id="sorteo"></div>
      <div class="botones">
        <button type="button" class="btn" id="cancelar">Cancelar</button>
        <button type="button" class="btn negro" id="sortear">🎲 Sortear parejas</button>
        <button type="submit" class="btn primario" id="crear" disabled>Crear</button>
      </div>
    </form>`);
  const pintarJug = () => {
    $("#jug", v).innerHTML = st.amigos.map((a) => `<button type="button" class="chip ${elegidos.has(a.id) ? "on" : ""}" data-id="${a.id}">${esc(a.nombre)}</button>`).join("");
    v.querySelectorAll("#jug .chip").forEach((b) => (b.onclick = () => {
      elegidos.has(b.dataset.id) ? elegidos.delete(b.dataset.id) : elegidos.add(b.dataset.id);
      parejas = null; $("#sorteo", v).innerHTML = ""; $("#crear", v).disabled = true;
      pintarJug();
    }));
  };
  pintarJug();
  $("#cancelar", v).onclick = cerrarHoja;
  $("#sortear", v).onclick = () => {
    if (elegidos.size < 4 || elegidos.size % 2) return toast(`Llevas ${elegidos.size}. Tiene que ser un número par (mínimo 4)`);
    const m = mezclar([...elegidos]);
    parejas = [];
    for (let i = 0; i < m.length; i += 2) parejas.push([m[i], m[i + 1]]);
    $("#sorteo", v).innerHTML = `<div class="sorteo">${parejas.map((p, i) => `<div><span>Pareja ${i + 1}</span><b>${p.map((id) => esc(nombre(id))).join(" y ")}</b></div>`).join("")}</div>`;
    $("#sortear", v).textContent = "🎲 Volver a sortear";
    $("#crear", v).disabled = false;
  };
  $("#fTorneo", v).onsubmit = async (ev) => {
    ev.preventDefault();
    if (!parejas) return;
    const f = new FormData(ev.target);
    // cuadro de 2, 4, 8… con pases directos si faltan parejas
    let tam = 2; while (tam < parejas.length) tam *= 2;
    let pases = tam - parejas.length;
    const slots = [];
    let k = 0;
    for (let i = 0; i < tam / 2; i++) {
      if (pases > 0) { slots.push(k++, null); pases--; } else slots.push(k++, k++);
    }
    const rondas = [];
    for (let n = tam / 2; n >= 1; n /= 2) rondas.push(Array(n).fill(null));
    rondas[0] = rondas[0].map((_, i) => (slots[2 * i + 1] == null ? slots[2 * i] : null));
    const { data, error: e } = await sb.from("torneos").insert({ nombre: f.get("nombre").trim(), fecha: f.get("fecha"), datos: { parejas, slots, rondas } }).select();
    if (e) return error(e);
    st.torneos.unshift(data[0]);
    verTorneo(data[0].id);
    cargarTodo();
  };
}

function verTorneo(id) {
  const t = st.torneos.find((x) => x.id === id);
  if (!t) return cerrarHoja();
  const { parejas, rondas } = t.datos;
  const slots = ranurasDe(t);
  const nombreRonda = (r) => ["Final", "Semifinales", "Cuartos de final", "Octavos de final"][rondas.length - 1 - r];
  // quién juega cada partido de cada ronda
  const lados = (r, i) => (r === 0 ? [slots[2 * i], slots[2 * i + 1]] : [rondas[r - 1][2 * i], rondas[r - 1][2 * i + 1]]);
  const txt = (k) => (k == null ? "<i>Por definir</i>" : parejas[k].map((x) => esc(nombre(x))).join(" y "));
  const camp = campeonTorneo(t);

  const v = hoja(`
    <h3>⚡ ${esc(t.nombre)}</h3>
    <p class="sub">${fechaLarga(t.fecha)} · toca a la pareja que ganó cada partido</p>
    ${camp ? `<div class="campeon">🏆 Campeones<br><b>${camp.map((x) => esc(nombre(x))).join(" y ")}</b></div>` : ""}
    ${rondas.map((ronda, r) => `
      <div class="ronda"><h4>${nombreRonda(r)}</h4>
        ${ronda.map((g, i) => {
          const [a, b] = lados(r, i);
          const listo = a != null && b != null;
          if (r === 0 && b == null) return `<div class="duelo"><button class="lado gano" disabled>${txt(a)}</button><span></span><span class="pase">Pase directo</span></div>`;
          return `<div class="duelo">
            <button class="lado ${g === a && g != null ? "gano" : ""}" ${listo ? `data-gana="${r}|${i}|${a}"` : "disabled"}>${txt(a)}</button>
            <span>vs</span>
            <button class="lado ${g === b && g != null ? "gano" : ""}" ${listo ? `data-gana="${r}|${i}|${b}"` : "disabled"}>${txt(b)}</button>
          </div>`;
        }).join("")}
      </div>`).join("")}
    <div class="botones">
      <button class="btn peligro" id="borrar">Borrar torneo</button>
      <button class="btn primario" id="cerrar">Cerrar</button>
    </div>`, () => verTorneo(id));
  $("#cerrar", v).onclick = cerrarHoja;
  $("#borrar", v).onclick = async () => {
    if (!confirm("¿Borrar este torneo?")) return;
    const { error: e } = await sb.from("torneos").delete().eq("id", id);
    if (e) return error(e);
    cerrarHoja(); cargarTodo();
  };
  v.querySelectorAll("[data-gana]").forEach((b) => (b.onclick = async () => {
    const [r, i, k] = b.dataset.gana.split("|").map(Number);
    const nuevas = rondas.map((x) => [...x]);
    nuevas[r][i] = nuevas[r][i] === k ? null : k;
    // si cambia un resultado, se limpian las rondas siguientes que dependían de él
    for (let rr = r + 1, ii = i; rr < nuevas.length; rr++) { ii = Math.floor(ii / 2); nuevas[rr][ii] = null; }
    t.datos = { ...t.datos, rondas: nuevas };
    const { error: e } = await sb.from("torneos").update({ datos: t.datos }).eq("id", id);
    if (e) return error(e);
    if (r === nuevas.length - 1 && nuevas[r][0] != null) toast("🏆 ¡Tenemos campeones!");
    verTorneo(id);
  }));
}

// ---------- Reacciones y comentarios ----------
function barraReacciones(tipo, id, conComentarios = true) {
  const rs = st.reacciones.filter((x) => x.tipo === tipo && x.objeto_id === id);
  const nCom = st.comentarios.filter((x) => x.tipo === tipo && x.objeto_id === id).length;
  return `<div class="reacciones">
    ${EMOJIS.map((em) => {
      const de = rs.filter((x) => x.emoji === em);
      const mio = de.some((x) => x.amigo_id === st.yo);
      return `<button class="reac ${mio ? "on" : ""}" data-reac="${tipo}|${id}|${em}" title="${esc(de.map((x) => nombre(x.amigo_id)).join(", "))}">${em}${de.length ? ` <b>${de.length}</b>` : ""}</button>`;
    }).join("")}
    ${conComentarios ? `<button class="reac" data-coment="${tipo}|${id}">💬${nCom ? ` <b>${nCom}</b>` : ""}</button>` : ""}
  </div>`;
}

async function toggleReaccion(tipo, id, emoji) {
  if (!necesitoYo()) return;
  const ya = st.reacciones.some((x) => x.tipo === tipo && x.objeto_id === id && x.amigo_id === st.yo && x.emoji === emoji);
  const fila = { tipo, objeto_id: id, amigo_id: st.yo, emoji };
  // se pinta al instante y luego se guarda
  st.reacciones = ya ? st.reacciones.filter((x) => !(x.tipo === tipo && x.objeto_id === id && x.amigo_id === st.yo && x.emoji === emoji)) : [...st.reacciones, fila];
  pintar(); if (st.reabrir) st.reabrir();
  const { error: e } = ya
    ? await sb.from("reacciones").delete().match(fila)
    : await sb.from("reacciones").insert(fila);
  if (e) { error(e); cargarTodo(); }
}

function haceCuanto(ts) {
  const min = Math.round((Date.now() - new Date(ts)) / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  if (min < 60 * 24) return `hace ${Math.round(min / 60)} h`;
  return fechaCorta(new Date(ts).toISOString().slice(0, 10));
}

function bloqueComentarios(tipo, id) {
  const cs = st.comentarios.filter((x) => x.tipo === tipo && x.objeto_id === id);
  return `<div class="comentarios">
    ${cs.map((c) => `<div class="com"><b>${esc(c.autor ? nombre(c.autor) : "Alguien")}</b> ${esc(c.texto)}
      <small>${haceCuanto(c.creado_en)}${c.autor === st.yo ? ` · <button class="enlace mini" data-borrarcom="${c.id}">borrar</button>` : ""}</small></div>`).join("")}
    <form class="comForm"><input name="texto" placeholder="Escribe un comentario…" maxlength="500" autocomplete="off"><button class="btn primario chico">Enviar</button></form>
  </div>`;
}

function enlazarComentarios(v, tipo, id) {
  const f = $(".comForm", v);
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    if (!necesitoYo()) return;
    const texto = f.texto.value.trim();
    if (!texto) return;
    f.querySelector("button").disabled = true;
    const { error: e } = await sb.from("comentarios").insert({ tipo, objeto_id: id, autor: st.yo, texto });
    if (e) { f.querySelector("button").disabled = false; return error(e); }
    cargarTodo();
  };
  v.querySelectorAll("[data-borrarcom]").forEach((b) => (b.onclick = async () => {
    const { error: e } = await sb.from("comentarios").delete().eq("id", b.dataset.borrarcom);
    if (e) return error(e);
    cargarTodo();
  }));
}

function verComentarios(tipo, id) {
  const pub = st.publicaciones.find((x) => x.id === id);
  const v = hoja(`
    <h3>💬 Comentarios</h3>
    ${pub?.texto ? `<p class="sub">${esc(pub.texto.slice(0, 120))}${pub.texto.length > 120 ? "…" : ""}</p>` : ""}
    ${barraReacciones(tipo, id, false)}
    ${bloqueComentarios(tipo, id)}
    <div class="botones"><button class="btn" id="cerrar">Cerrar</button></div>`, () => verComentarios(tipo, id));
  $("#cerrar", v).onclick = cerrarHoja;
  enlazarComentarios(v, tipo, id);
}

// ---------- Resumen del año ("Wrapped") ----------
function abrirResumen(anio) {
  const jugados = st.partidos.filter((p) => p.ganador && p.fecha.startsWith(anio));
  const agendados = st.partidos.filter((p) => p.fecha.startsWith(anio));
  const { tabla } = calcularRanking(anio);
  const { tablaParejas, listaRachas } = estadisticasParejas(anio);
  const lugares = {};
  for (const p of agendados) if (p.lugar) lugares[p.lugar] = (lugares[p.lugar] || 0) + 1;
  const lugar = Object.entries(lugares).sort((a, b) => b[1] - a[1])[0];
  const mvp = titulosDelDia((f) => f.startsWith(anio))[0];
  const racha = [...listaRachas].sort((a, b) => b.mejor - a.mejor)[0];
  const fotosAnio = st.recuerdos.filter((r) => (r.fecha || "").startsWith(anio));
  const fotoTop = fotosAnio
    .map((r) => ({ r, n: st.reacciones.filter((x) => x.tipo === "foto" && x.objeto_id === r.id).length }))
    .sort((a, b) => b.n - a.n)[0];
  const torneosAnio = st.torneos.filter((t) => t.fecha.startsWith(anio) && campeonTorneo(t));
  const nombres = (ids) => ids.map((i) => esc(nombre(i))).join(" y ");

  const slides = [
    `<small>Pendejos<span class="punto">.</span></small><h1>Resumen<br>${anio}</h1><p>Su año de pádel en unos cuantos números 🎾</p>`,
    `<small>Este año jugaron</small><h1 class="enorme">${jugados.length}</h1><p>partidos${lugar ? `<br>y su cancha favorita fue <b>${esc(lugar[0])}</b>` : ""}</p>`,
    tabla[0] && `<small>🏆 El más ganador</small><h1>${esc(nombre(tabla[0].id))}</h1><p><b>${tabla[0].g}</b> victorias de ${tabla[0].j} partidos (${tabla[0].pct}%)</p>${tabla[1] ? `<p class="tenue">Le siguió ${esc(nombre(tabla[1].id))} con ${tabla[1].g}</p>` : ""}`,
    tablaParejas[0] && `<small>🤝 La pareja de oro</small><h1>${nombres(tablaParejas[0].ids)}</h1><p><b>${tablaParejas[0].g}</b> victorias juntos</p>`,
    racha?.mejor >= 2 && `<small>🔥 La racha más larga</small><h1 class="enorme">${racha.mejor}</h1><p>victorias seguidas de <b>${esc(nombre(racha.id))}</b></p>`,
    mvp && `<small>⭐ El mejor jugador del año</small><h1>${esc(nombre(mvp[0]))}</h1><p>Fue el mejor del día <b>${mvp[1]}</b> ${mvp[1] === 1 ? "vez" : "veces"}</p>`,
    torneosAnio.length && `<small>⚡ Torneos relámpago</small><h1 class="enorme">${torneosAnio.length}</h1><p>${torneosAnio.slice(0, 4).map((t) => `${esc(t.nombre)}: <b>${nombres(campeonTorneo(t))}</b>`).join("<br>")}</p>`,
    fotoTop && st.urls[fotoTop.r.ruta] && `<small>📸 El momento del año</small><img src="${esc(st.urls[fotoTop.r.ruta])}" alt="">${fotoTop.r.descripcion ? `<p>${esc(fotoTop.r.descripcion)}</p>` : ""}`,
    `<small>Y esto apenas empieza</small><h1>Nos vemos<br>en ${Number(anio) + 1}</h1><p>🎾🔥</p>`,
  ].filter(Boolean);

  let i = 0;
  const div = document.createElement("div");
  div.className = "wrapped";
  document.body.appendChild(div);
  document.body.classList.add("bloqueado");
  const pintarSlide = () => {
    div.innerHTML = `
      <div class="barras">${slides.map((_, k) => `<span class="${k <= i ? "on" : ""}"></span>`).join("")}</div>
      <button class="cerrarW" aria-label="Cerrar">✕</button>
      <div class="slide s${i % 3}">${slides[i]}</div>
      <p class="pista">${i < slides.length - 1 ? "Toca para seguir →" : "Toca para cerrar"}</p>`;
    $(".cerrarW", div).onclick = (e) => { e.stopPropagation(); cerrar(); };
  };
  const cerrar = () => { div.remove(); document.body.classList.remove("bloqueado"); };
  div.onclick = (e) => {
    const izq = e.clientX < window.innerWidth * 0.3;
    if (izq) i = Math.max(0, i - 1);
    else if (i < slides.length - 1) i++;
    else return cerrar();
    pintarSlide();
  };
  pintarSlide();
}

// ---------- Subir fotos desde un partido ----------
document.addEventListener("change", (e) => {
  const inp = e.target.closest("[data-subirpartido]");
  if (inp && inp.files.length) { formFotos([...inp.files], inp.dataset.subirpartido); inp.value = ""; }
});

// ---------- Clics globales ----------
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-reac],[data-coment],[data-rsvp],[data-mvp],[data-resumen],[data-jugadores],[data-wa],[data-intercambio],[data-adviento],[data-agendarpadel],[data-album],[data-pregunta],[data-cambiarpregunta],[data-chismes],[data-jugar],[data-perfil]");
  if (!t) return;
  if (t.dataset.reac) { const [tipo, id, em] = t.dataset.reac.split("|"); toggleReaccion(tipo, id, em); }
  else if (t.dataset.coment) { const [tipo, id] = t.dataset.coment.split("|"); verComentarios(tipo, id); }
  else if (t.dataset.rsvp) { const [id, estado] = t.dataset.rsvp.split("|"); marcarAsistencia(id, estado); }
  else if (t.dataset.mvp) votarMVP(t.dataset.mvp);
  else if (t.dataset.resumen) abrirResumen(t.dataset.resumen);
  else if (t.dataset.jugadores) elegirJugadores(t.dataset.jugadores);
  else if (t.dataset.wa) abrirWA(t.dataset.wa);
  else if (t.dataset.intercambio) verIntercambio();
  else if (t.dataset.adviento) verAdviento();
  else if (t.dataset.agendarpadel) formPartido(null);
  else if (t.dataset.album) verAlbum(t.dataset.album);
  else if (t.dataset.pregunta) votarPregunta(t.dataset.pregunta);
  else if (t.dataset.cambiarpregunta) { st.votosPregunta = st.votosPregunta.filter((v) => !(v.fecha === hoyISO() && v.votante === st.yo)); pintar(); }
  else if (t.dataset.chismes) verChismes();
  else if (t.dataset.jugar) abrirJuego();
  else if (t.dataset.perfil) verPerfil(t.dataset.perfil);
});

// =============================================================
//  CHAT DEL GRUPO (tiempo real)
// =============================================================
const CLAVE_LEIDO = "pdj_chat_leido";
let canalChat = null;

function leidoHasta() { try { return localStorage.getItem(CLAVE_LEIDO) || ""; } catch { return ""; } }
function marcarLeido() {
  const ultimo = st.mensajes[st.mensajes.length - 1]?.creado_en || new Date().toISOString();
  try { localStorage.setItem(CLAVE_LEIDO, ultimo); } catch {}
  pintarBadgeChat();
}
function noLeidos() {
  const desde = leidoHasta();
  return st.mensajes.filter((m) => m.autor !== st.yo && m.creado_en > desde).length;
}
function pintarBadgeChat() {
  const b = document.querySelector('.tabs button[data-tab="chat"]');
  if (!b) return;
  const n = st.tab === "chat" ? 0 : noLeidos();
  let badge = b.querySelector(".badge");
  if (!n) { badge?.remove(); return; }
  if (!badge) { badge = document.createElement("i"); badge.className = "badge"; b.appendChild(badge); }
  badge.textContent = n > 99 ? "99+" : n;
}

function conectarChat() {
  if (canalChat || !sb) return;
  canalChat = sb.channel("chat-grupo")
    .on("postgres_changes", { event: "*", schema: "public", table: "mensajes" }, async (cambio) => {
      if (cambio.eventType === "INSERT") {
        const m = cambio.new;
        if (st.mensajes.some((x) => x.id === m.id)) return;
        st.mensajes.push(m);
        if (m.imagen_ruta) await firmarFotos().catch(() => {});
      } else if (cambio.eventType === "DELETE") {
        st.mensajes = st.mensajes.filter((x) => x.id !== cambio.old.id);
      } else if (cambio.eventType === "UPDATE") {
        st.mensajes = st.mensajes.map((x) => (x.id === cambio.new.id ? cambio.new : x));
      }
      if (st.tab === "chat") { const abajo = estaAbajo(); pintar(); if (abajo) bajarChat(); marcarLeido(); }
      else pintarBadgeChat();
    })
    .subscribe();
}

const estaAbajo = () => window.innerHeight + window.scrollY >= document.body.scrollHeight - 140;
const bajarChat = () => requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
const horaMsg = (ts) => new Date(ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const diaMsg = (ts) => {
  const d = iso(new Date(ts));
  if (d === hoyISO()) return "Hoy";
  if (d === iso(new Date(Date.now() - 864e5))) return "Ayer";
  return fechaLarga(d);
};

function vistaChat() {
  let ultimoDia = "";
  const reac = (id) => {
    const rs = st.reacciones.filter((x) => x.tipo === "msg" && x.objeto_id === id);
    if (!rs.length) return "";
    const cuenta = {};
    for (const r of rs) cuenta[r.emoji] = (cuenta[r.emoji] || 0) + 1;
    return `<div class="msgReac">${Object.entries(cuenta).map(([e, n]) => `${e}${n > 1 ? n : ""}`).join(" ")}</div>`;
  };
  const items = st.mensajes.map((m, i) => {
    const mio = m.autor === st.yo;
    const a = st.amigos.find((x) => x.id === m.autor);
    const prev = st.mensajes[i - 1];
    const seguido = prev && prev.autor === m.autor && new Date(m.creado_en) - new Date(prev.creado_en) < 5 * 60000;
    const dia = diaMsg(m.creado_en);
    const sep = dia !== ultimoDia ? `<div class="diaSep"><span>${dia}</span></div>` : "";
    ultimoDia = dia;
    const resp = m.responde_a && st.mensajes.find((x) => x.id === m.responde_a);
    return `${sep}<div class="msg ${mio ? "mio" : ""} ${seguido && !sep ? "seguido" : ""}">
      ${!mio ? `<div class="msgAvatar">${seguido && !sep ? "" : avatar(a, "chico")}</div>` : ""}
      <button class="burbuja" data-msg="${m.id}">
        ${!mio && !(seguido && !sep) ? `<b class="msgAutor">${esc(a?.nombre || "Alguien")}</b>` : ""}
        ${resp ? `<div class="msgResp"><b>${esc(nombre(resp.autor))}</b> ${esc((resp.texto || "📷 Foto").slice(0, 80))}</div>` : ""}
        ${m.imagen_ruta && st.urls[m.imagen_ruta] ? `<img src="${esc(st.urls[m.imagen_ruta])}" alt="" loading="lazy">` : ""}
        ${m.texto ? `<span class="msgTexto">${esc(m.texto).replace(/\n/g, "<br>")}</span>` : ""}
        <small class="msgHora">${horaMsg(m.creado_en)}</small>
      </button>
      ${reac(m.id)}
    </div>`;
  }).join("");
  const resp = st.respondiendo && st.mensajes.find((x) => x.id === st.respondiendo);
  return `
    <div class="chat">
      ${st.mensajes.length ? items : `<div class="chatVacio">💬<br><b>El chat de los Pendejos</b><br><span class="sub">Escriban el primer mensaje. Todos reciben notificación.</span></div>`}
    </div>
    <form id="fChat" class="chatBarra">
      ${resp ? `<div class="chatResp"><span>↩️ <b>${esc(nombre(resp.autor))}</b>: ${esc((resp.texto || "📷 Foto").slice(0, 60))}</span><button type="button" id="cancelarResp">✕</button></div>` : ""}
      <div class="chatFila">
        <label class="chatFoto">📷<input type="file" accept="image/*" id="chatImg" hidden></label>
        <textarea id="chatTexto" rows="1" placeholder="Escribe un mensaje…" maxlength="2000">${esc(st.borrador || "")}</textarea>
        <button class="chatEnviar" aria-label="Enviar">➤</button>
      </div>
    </form>`;
}

async function enviarChat(texto, imagenRuta = null) {
  if (!necesitoYo()) return;
  const fila = { autor: st.yo, texto: texto || null, imagen_ruta: imagenRuta, responde_a: st.respondiendo || null };
  const { data, error: e } = await sb.from("mensajes").insert(fila).select();
  if (e) return error(e);
  st.respondiendo = null;
  if (data?.[0] && !st.mensajes.some((x) => x.id === data[0].id)) st.mensajes.push(data[0]);
  if (imagenRuta) await firmarFotos().catch(() => {});
  pintar(); bajarChat(); marcarLeido();
}

function accionesMensaje(id) {
  const m = st.mensajes.find((x) => x.id === id);
  if (!m) return;
  const puedeBorrar = m.autor === st.yo || st.esAdmin;
  const v = hoja(`
    <div class="reacciones grandes">${EMOJIS.concat(["👍", "😮"]).map((em) => {
      const mio = st.reacciones.some((x) => x.tipo === "msg" && x.objeto_id === id && x.amigo_id === st.yo && x.emoji === em);
      return `<button class="reac ${mio ? "on" : ""}" data-r="${em}">${em}</button>`;
    }).join("")}</div>
    <div class="botones" style="justify-content:stretch">
      <button class="btn" id="responder">↩️ Responder</button>
      ${m.texto ? `<button class="btn" id="copiar">📋 Copiar</button>` : ""}
      ${puedeBorrar ? `<button class="btn peligro" id="borrarMsg">Borrar</button>` : ""}
    </div>`);
  v.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => { cerrarHoja(); toggleReaccion("msg", id, b.dataset.r); }));
  $("#responder", v).onclick = () => { st.respondiendo = id; cerrarHoja(); pintar(); $("#chatTexto")?.focus(); };
  $("#copiar", v)?.addEventListener("click", () => { navigator.clipboard?.writeText(m.texto); cerrarHoja(); toast("Copiado"); });
  $("#borrarMsg", v)?.addEventListener("click", async () => {
    if (!confirm("¿Borrar este mensaje para todos?")) return;
    const { error: e } = await sb.from("mensajes").delete().eq("id", id);
    if (e) return error(e);
    if (m.imagen_ruta) sb.storage.from(BUCKET).remove([m.imagen_ruta]);
    st.mensajes = st.mensajes.filter((x) => x.id !== id);
    cerrarHoja(); pintar();
  });
}

function enlazarChat() {
  const t = $("#chatTexto");
  const ajustar = () => { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px"; };
  ajustar();
  t.oninput = () => { st.borrador = t.value; ajustar(); };
  $("#fChat").onsubmit = (ev) => {
    ev.preventDefault();
    const texto = t.value.trim();
    if (!texto) return;
    st.borrador = "";
    t.value = "";
    enviarChat(texto);
  };
  t.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !/iphone|ipad|android/i.test(navigator.userAgent)) { e.preventDefault(); $("#fChat").requestSubmit(); } };
  $("#cancelarResp")?.addEventListener("click", () => { st.respondiendo = null; pintar(); });
  $("#chatImg").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    toast("Subiendo foto…");
    try { const ruta = await subirImagen(f, "chat", 1280); await enviarChat(st.borrador?.trim() || null, ruta); st.borrador = ""; }
    catch (err) { error(err); }
  };
  document.querySelectorAll("[data-msg]").forEach((b) => (b.onclick = () => accionesMensaje(b.dataset.msg)));
  marcarLeido();
}


// =============================================================
//  FRASE DEL DÍA · BIENVENIDA · LOGROS
// =============================================================
const FRASES = [
  "Hoy no se pierde, hoy se aprende… a echarle la culpa a la pareja. 😎",
  "El pádel no se juega con las piernas, se juega con el ego. 💪",
  "Si la bola entra, fue talento. Si no entra, fue el viento. 🌬️",
  "Entrena como si fueras Bela, juega como si nadie te viera. 🎾",
  "La red no es tu enemiga… bueno, a veces sí. 🙃",
  "Hoy es buen día para una bandeja perfecta (o para intentarlo). ✨",
  "Los campeones no nacen, se hacen sudando en la pista. 🏆",
  "Recuerda: la víbora es un golpe, no tu personalidad. 🐍",
  "Una buena pareja de pádel vale más que un buen sueldo. 💛",
  "No importa cuántas veces falles el globo, importa que llegues a las cañas. 🍻",
  "Hoy toca dar el 100%… o al menos el 60% con estilo. 😏",
  "El que no corre, vuela… pero a la red. 🪶",
  "Tu mejor golpe es el que todavía no has inventado. 🚀",
  "Calienta bien, que luego duele todo. 🧘",
  "Sin drama no hay pádel. Sin pádel no hay drama. Equilibrio. ⚖️",
  "Hoy tu revés va a sorprender a todos (incluido a ti). 😂",
  "La constancia gana partidos; los chismes ganan amigos. 🗣️",
  "Si hoy no juegas, al menos vota al mejor del día. ⭐",
  "Todo gran remontada empieza con un 'esta la sacamos'. 🔥",
  "No eres lento, es que le das emoción al punto. ⏳",
  "Pala en mano, excusas en el bolsillo. 🎒",
  "Hoy se sale a la pista con actitud de final del World Padel Tour. 🌍",
  "Ganar está bien, pero presumirlo en el chat está mejor. 💬",
  "Hidrátate: agua antes, cerveza después. 💧🍺",
  "El mejor partido es el que se juega con amigos (y se gana). 🤝",
  "Hoy dile a tu pareja de pádel que la quieres… antes de que falle. ❤️",
  "Smash con fe, aunque la bola vaya fuera. 🙏",
  "Un buen día empieza con un 'Voy' en la app. 🙋",
  "No hay mala pareja, hay mala comunicación. Hablen. 🗯️",
  "La pista te espera, el sofá también. Elige sabiamente. 🛋️",
  "Hoy te toca brillar más que la pelota nueva. ✨",
  "Pendejos sí, rendidos nunca. 💥",
];
function fraseDelDia() {
  const d = new Date();
  const dia = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
  const lista = st.frases?.length ? st.frases.map((f) => f.texto) : FRASES; // las de la base de datos mandan
  return lista[(dia + d.getFullYear()) % lista.length];
}

// ---------- Pop-up de bienvenida: una vez al día, con la frase motivadora ----------
function bienvenida() {
  const clave = "pdj_bienvenida_" + st.yo;
  const hoy = hoyISO();
  let primeraVez = false;
  try {
    primeraVez = !localStorage.getItem("pdj_onboard_" + st.yo);
    if (!primeraVez && localStorage.getItem(clave) === hoy) return;
  } catch { return; }
  const yo = st.amigos.find((a) => a.id === st.yo);
  if (!yo) return;
  if (primeraVez) return primerInicio(yo, () => { try { localStorage.setItem("pdj_onboard_" + st.yo, "1"); localStorage.setItem(clave, hoy); } catch {} });
  const h = new Date().getHours();
  const saludo = h < 13 ? "¡Buenos días" : h < 20 ? "¡Buenas tardes" : "¡Buenas noches";
  const v = hoja(`
    <div class="bienvenida">
      ${avatar(yo, "enorme")}
      <h2>${saludo}, ${esc(yo.nombre)}! 👋</h2>
      <div class="fraseDia"><small>✨ FRASE DEL DÍA</small><p>${esc(fraseDelDia())}</p></div>
      <button class="btn primario ancho" id="bVamos">¡Vamos! 🎾</button>
    </div>`);
  const cerrar = () => { try { localStorage.setItem(clave, hoy); } catch {} cerrarHoja(); };
  $("#bVamos", v).onclick = cerrar;
  v.addEventListener("click", (e) => { if (e.target === v) cerrar(); });
}

// ---------- Bienvenida la primera vez que alguien inicia sesión ----------
function primerInicio(yo, listo) {
  const pasos = [
    { ico: avatar(yo, "enorme"), t: `¡Bienvenid@ a Pendejos, ${esc(yo.nombre)}! 🎾`, d: "Aquí van los partidos, los planes, los cumples, el chat y la votación del mejor jugador del día." },
    { ico: `<div class="bienIco">📸</div>`, t: "Ponte guap@", d: "Sube tu foto, tu apodo, de qué lado juegas y tu cumpleaños para que todos te feliciten.", b: ["Completar mi perfil", () => { cerrar(); formAmigo(yo); }] },
    { ico: `<div class="bienIco">🔔</div>`, t: "Que no se te pase nada", d: esIOS && !instalada ? "Agrégala a tu pantalla: en Safari toca <b>Compartir</b> → <b>Agregar a inicio</b>. Ábrela desde el ícono y activa la campanita 🔔." : "Activa las notificaciones para enterarte de partidos, cumples y mensajes del chat.", b: !(esIOS && !instalada) ? ["Activar notificaciones", () => { cerrar(); abrirAvisos(); }] : null },
    { ico: `<div class="bienIco">🙋</div>`, t: "¡Listo, a jugar!", d: "Confirma con <b>Voy</b> o <b>No puedo</b>, vota al mejor del día ⭐ y escribe en el chat 💬.<br><br>" + `<i>${esc(fraseDelDia())}</i>` },
  ];
  let i = 0;
  const cerrar = () => { listo(); cerrarHoja(); };
  const pintarPaso = () => {
    const p = pasos[i];
    const v = hoja(`
      <div class="bienvenida">
        ${p.ico}
        <h2>${p.t}</h2>
        <p>${p.d}</p>
        ${p.b ? `<button class="btn negro ancho" id="bAccion">${p.b[0]}</button>` : ""}
        <div class="puntos">${pasos.map((_, k) => `<span class="${k === i ? "on" : ""}"></span>`).join("")}</div>
        <div class="botones" style="justify-content:space-between">
          <button class="btn" id="bSaltar">${i === pasos.length - 1 ? "Cerrar" : "Saltar"}</button>
          <button class="btn primario" id="bSig">${i === pasos.length - 1 ? "¡Vamos! 🎾" : "Siguiente"}</button>
        </div>
      </div>`);
    $("#bSaltar", v).onclick = cerrar;
    $("#bSig", v).onclick = () => { if (i < pasos.length - 1) { i++; pintarPaso(); } else cerrar(); };
    $("#bAccion", v)?.addEventListener("click", p.b[1]);
  };
  pintarPaso();
}

// ---------- Logros ----------
function logrosDe(id) {
  const jugadosPadel = st.partidos.filter((p) => esPadel(p) && yaPaso(p) && (jugadoresDe(p).includes(id) || (p.jugadores || []).includes(id)));
  const r = calcularRanking("todo").tabla.find((x) => x.id === id) || { g: 0, j: 0 };
  const racha = estadisticasParejas("todo").listaRachas.find((x) => x.id === id)?.mejor || 0;
  const dias = titulosDelDia(() => true).find(([x]) => x === id)?.[1] || 0;
  const mesActual = mvpPorMes(hoyISO().slice(0, 4)).find((m) => m.k === hoyISO().slice(0, 7));
  const noPuedo = st.asistencias.filter((x) => x.amigo_id === id && x.estado === "no").length;
  const fiestas = st.asistencias.filter((x) => x.amigo_id === id && x.estado === "voy" && st.partidos.some((p) => p.id === x.partido_id && !esPadel(p))).length;
  const usuario = st.amigos.find((a) => a.id === id)?.usuario;
  const fotos = st.recuerdos.filter((x) => usuario && x.subido_por === usuario).length;
  const msgs = st.mensajes.filter((x) => x.autor === id).length;
  return [
    ["🎾", "Debut", "Jugó su primer pádel", jugadosPadel.length >= 1],
    ["💪", "Fiel", "5 pádel jugados", jugadosPadel.length >= 5],
    ["🦾", "Inquebrantable", "20 pádel jugados", jugadosPadel.length >= 20],
    ["🏆", "Ganador", "5 victorias", r.g >= 5],
    ["🔥", "En racha", "3 victorias seguidas", racha >= 3],
    ["⭐", "Estrella", "Mejor jugador de un día", dias >= 1],
    ["👑", "Rey/Reina del mes", "Mejor jugador de este mes", mesActual?.id === id],
    ["🎉", "Fiestero", "Fue a 3 planes que no son pádel", fiestas >= 3],
    ["📸", "Paparazzi", "Subió 5 fotos", fotos >= 5],
    ["💬", "Parlanchín", "50 mensajes en el chat", msgs >= 50],
    ["🙄", "El que se raja", "Dijo 'No puedo' 3 veces", noPuedo >= 3],
  ];
}

function seccionLogros(id) {
  const ls = logrosDe(id);
  const n = ls.filter((l) => l[3]).length;
  return `<h4 class="subtitulo">🏅 Logros (${n}/${ls.length})</h4>
    <div class="logros">${ls.map(([ico, t, d, ok]) => `<div class="logro ${ok ? "ok" : ""}" title="${esc(d)}"><span>${ico}</span><b>${esc(t)}</b><small>${esc(d)}</small></div>`).join("")}</div>`;
}

// =============================================================
//  NAVIDAD: cuenta regresiva, nieve, adviento e intercambio
// =============================================================
const temporadaNavidad = () => {
  const h = hoyISO(), y = h.slice(0, 4);
  return h >= `${y}-11-15` || h <= `${y}-01-06`;
};
function diasParaNavidad() {
  const h = parseISO(hoyISO());
  let nav = new Date(h.getFullYear(), 11, 25);
  if (h > nav) nav = new Date(h.getFullYear() + 1, 11, 25);
  return Math.round((nav - h) / 864e5);
}
function nieveHTML() {
  let copos = "";
  for (let i = 0; i < 18; i++) {
    const izq = Math.round(Math.random() * 100), dur = 6 + Math.random() * 8, ret = -Math.random() * 12, tam = 0.6 + Math.random() * 0.9;
    copos += `<i style="left:${izq}%;animation-duration:${dur}s;animation-delay:${ret}s;font-size:${tam}rem">❄</i>`;
  }
  return `<div class="nieve" aria-hidden="true">${copos}</div>`;
}

function tarjetaNavidad() {
  if (!temporadaNavidad() || !st.navidad) return "";
  const d = diasParaNavidad();
  const h = hoyISO(), mes = h.slice(5, 7), dia = Number(h.slice(8, 10));
  const enAdviento = mes === "12" && dia <= 24;
  const titulo = d === 0 ? "🎄 ¡Feliz Navidad, Pendejos! 🎅" : d === 1 ? "🎅 ¡Mañana es Navidad!" : d > 300 ? "🥂 ¡Feliz año nuevo!" : `🎄 Faltan <b>${d}</b> días para Navidad`;
  const nav = st.navidad;
  return `<section class="navidad">
    ${nieveHTML()}
    <div class="navTitulo">${titulo}</div>
    ${nav.intercambio_activo ? `<div class="navBotones"><button class="btn" data-intercambio="1">🎁 Intercambio</button></div>` : ""}
  </section>`;
}

// ---------- Adviento ----------
function verAdviento() {
  const h = hoyISO(), y = h.slice(0, 4);
  const abierto = (d) => h >= `${y}-12-${String(d).padStart(2, "0")}` && h.slice(5, 7) === "12";
  const v = hoja(`
    <h3>📅 Calendario de adviento</h3>
    <p class="sub">Del 1 al 24 de diciembre se abre una casilla cada día.</p>
    <div class="adviento">${Array.from({ length: 24 }, (_, i) => i + 1).map((d) => `<button class="casilla ${abierto(d) ? "abierta" : ""}" data-dia="${d}">${abierto(d) ? "🎁" : "🔒"}<b>${d}</b></button>`).join("")}</div>
    <div id="advTexto" class="advTexto"></div>
    <div class="botones"><button class="btn" id="cerrar">Cerrar</button></div>`);
  $("#cerrar", v).onclick = cerrarHoja;
  v.querySelectorAll("[data-dia]").forEach((b) => (b.onclick = () => {
    const d = Number(b.dataset.dia);
    $("#advTexto", v).innerHTML = abierto(d)
      ? `<b>Día ${d}</b><br>${esc(st.adviento.find((x) => x.dia === d)?.texto || "")}`
      : `🔒 El día ${d} se abre el ${d} de diciembre. ¡Paciencia! 😉`;
  }));
}

// ---------- Intercambio (amigo secreto) ----------
async function cargarIntercambio() {
  const [ic, de, pi] = await Promise.all([
    sb.from("intercambio").select("*"),
    sb.from("deseos").select("*").order("creado_en"),
    sb.from("pistas").select("texto, creado_en").order("creado_en", { ascending: false }),
  ]);
  st.intercambio = ic.error ? [] : ic.data;
  st.deseos = de.error ? [] : de.data;
  st.pistas = pi.error ? [] : pi.data;
}

async function verIntercambio() {
  await cargarIntercambio();
  const nav = st.navidad;
  const participantes = nav.participantes || [];
  const yoParticipo = participantes.includes(st.yo);
  const mio = st.intercambio.find((x) => x.da === st.yo);
  const deseosDe = (id) => st.deseos.filter((x) => x.amigo_id === id);
  const misDeseos = deseosDe(st.yo);

  const v = hoja(`
    <h3>🎁 Intercambio navideño</h3>
    <div class="navInfo">
      <span>💶 Monto: <b>${esc(nav.monto || "por definir")}</b></span>
      <span>📅 Día: <b>${nav.fecha ? fechaLarga(nav.fecha) : "por definir"}</b></span>
      <span>👥 ${participantes.length} participantes</span>
    </div>

    ${!nav.sorteado ? `<p class="vacio">🎲 Todavía no se hace el sorteo. ${st.esAdmin ? "Cuando estén todos listos, dale a Sortear." : "Simona avisará cuando esté listo."}</p>`
    : nav.revelado ? `<h4 class="subtitulo">🎉 ¡Revelado!</h4>${st.intercambio.map((x) => `<div class="fila">🎁 <b>${esc(nombre(x.da))}</b> le regaló a <b>${esc(nombre(x.recibe))}</b></div>`).join("")}`
    : mio ? `<div class="secreto" id="secreto"><small>🤫 TU AMIGO SECRETO ES…</small><b class="borroso">${esc(nombre(mio.recibe))}</b><span>Toca para ver (que nadie te vea 👀)</span></div>
      <h4 class="subtitulo">🎁 Lo que le gustaría a ${esc(nombre(mio.recibe))}</h4>
      ${deseosDe(mio.recibe).length ? deseosDe(mio.recibe).map((x) => `<div class="fila">• ${esc(x.texto)}</div>`).join("") : `<p class="vacio">Todavía no ha puesto deseos.</p>`}
      <form id="fPista" class="comForm"><input name="texto" maxlength="300" placeholder="Mándale una pista anónima…" autocomplete="off"><button class="btn primario chico">Enviar</button></form>`
    : `<p class="vacio">No estás en el sorteo de este año.</p>`}

    ${nav.sorteado && !nav.revelado && st.pistas.length ? `<h4 class="subtitulo">💌 Pistas que te mandó tu amigo secreto</h4>${st.pistas.map((x) => `<div class="fila">“${esc(x.texto)}” <small>· ${haceCuanto(x.creado_en)}</small></div>`).join("")}` : ""}

    ${yoParticipo ? `<h4 class="subtitulo">📝 Mi lista de deseos</h4>
      ${misDeseos.map((x) => `<div class="fila deseo">• ${esc(x.texto)} <button class="enlace mini" data-borrardeseo="${x.id}">quitar</button></div>`).join("") || `<p class="vacio">Agrega ideas para que tu amigo secreto acierte.</p>`}
      <form id="fDeseo" class="comForm"><input name="texto" maxlength="200" placeholder="Ej. Pelotas Head Pro, calcetines…" autocomplete="off"><button class="btn primario chico">Agregar</button></form>` : ""}

    ${st.esAdmin ? `<div class="tarjeta adminNav">
      <b>⚙️ Solo para ti (admin)</b>
      <div class="dos">
        <label>Monto<input id="nMonto" value="${esc(nav.monto || "")}" placeholder="20 €"></label>
        <label>Día<input id="nFecha" type="date" value="${nav.fecha || ""}"></label>
      </div>
      <label>¿Quiénes participan?</label>
      <div class="chips" id="nPart">${st.amigos.map((a) => `<button type="button" class="chip ${participantes.includes(a.id) ? "on" : ""}" data-id="${a.id}">${esc(a.nombre)}</button>`).join("")}</div>
      <div class="botones">
        <button class="btn" id="nGuardar">Guardar</button>
        <button class="btn negro" id="nSortear">🎲 ${nav.sorteado ? "Volver a sortear" : "Sortear"}</button>
        ${nav.sorteado && !nav.revelado ? `<button class="btn primario" id="nRevelar">🎉 Revelar a todos</button>` : ""}
      </div>
    </div>` : ""}
    <div class="botones"><button class="btn" id="cerrar">Cerrar</button></div>`, () => verIntercambio());

  $("#cerrar", v).onclick = cerrarHoja;
  $("#secreto", v)?.addEventListener("click", (e) => e.currentTarget.classList.toggle("visto"));
  $("#fPista", v)?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const texto = ev.target.texto.value.trim();
    if (!texto) return;
    const { error: e } = await sb.rpc("enviar_pista", { texto });
    if (e) return error(e);
    ev.target.reset(); toast("💌 Pista enviada en secreto");
  });
  $("#fDeseo", v)?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const texto = ev.target.texto.value.trim();
    if (!texto) return;
    const { error: e } = await sb.from("deseos").insert({ texto, amigo_id: st.yo });
    if (e) return error(e);
    verIntercambio();
  });
  v.querySelectorAll("[data-borrardeseo]").forEach((b) => (b.onclick = async () => {
    await sb.from("deseos").delete().eq("id", b.dataset.borrardeseo);
    verIntercambio();
  }));
  if (st.esAdmin) {
    const sel = new Set(participantes);
    v.querySelectorAll("#nPart .chip").forEach((b) => (b.onclick = () => {
      sel.has(b.dataset.id) ? sel.delete(b.dataset.id) : sel.add(b.dataset.id);
      b.classList.toggle("on");
    }));
    const guardar = async () => {
      const datos = { monto: $("#nMonto", v).value.trim() || null, fecha: $("#nFecha", v).value || null, participantes: [...sel] };
      const { error: e } = await sb.from("navidad").update(datos).eq("id", 1);
      if (e) { error(e); return false; }
      Object.assign(st.navidad, datos);
      return true;
    };
    $("#nGuardar", v).onclick = async () => { if (await guardar()) { toast("Guardado 🎄"); verIntercambio(); } };
    $("#nSortear", v).onclick = async () => {
      if (sel.size < 3) return toast("Se necesitan al menos 3");
      if (nav.sorteado && !confirm("¿Volver a sortear? Se borran las asignaciones y las pistas.")) return;
      if (!(await guardar())) return;
      const { error: e } = await sb.rpc("sortear_intercambio");
      if (e) return error(e);
      st.navidad.sorteado = true; st.navidad.revelado = false;
      toast("🎲 ¡Sorteo hecho! Cada quien ya ve su amigo secreto");
      enviarMensaje("🎁 ¡Ya está el sorteo!", "Entra a la app para ver quién es tu amigo secreto 🤫").catch(() => {});
      verIntercambio();
    };
    $("#nRevelar", v)?.addEventListener("click", async () => {
      if (!confirm("¿Revelar a todos quién le regaló a quién?")) return;
      const { error: e } = await sb.from("navidad").update({ revelado: true }).eq("id", 1);
      if (e) return error(e);
      st.navidad.revelado = true;
      verIntercambio();
    });
  }
}

// =============================================================
//  PÁDEL (pestaña), PREGUNTA DEL DÍA, CHISMES, FOTOS DEL PARTIDO,
//  PREMIO DEL MES Y MINI JUEGO
// =============================================================

// ---------- Próximo pádel (recordatorio) ----------
const proximoPadel = () => st.partidos.find((p) => esPadel(p) && !yaPaso(p));
function tarjetaProximoPadel() {
  const p = proximoPadel();
  if (!p) return `<section class="proxPadel vacio">
    <div><small>🎾 PRÓXIMO PÁDEL</small><b>Aún no hay fecha</b><span>¿Quién se anima a organizar? 😏</span></div>
    <button class="btn primario chico" data-agendarpadel="1">+ Agendar</button>
  </section>`;
  const d = Math.round((parseISO(p.fecha) - parseISO(hoyISO())) / 864e5);
  const cuando = d === 0 ? "¡HOY!" : d === 1 ? "MAÑANA" : `EN ${d} DÍAS`;
  const van = vanA(p), mio = st.asistencias.find((x) => x.partido_id === p.id && x.amigo_id === st.yo)?.estado;
  return `<section class="proxPadel">
    <div class="ppCab"><small>🎾 PRÓXIMO PÁDEL · <b>${cuando}</b></small></div>
    <b class="ppFecha">${fechaLarga(p.fecha)}${p.hora ? " · " + horario(p) : ""}</b>
    <span class="ppLugar">📍 ${esc(p.lugar || CANCHA)}</span>
    <div class="ppVan">${van.length >= 4 ? "✅ ¡Ya son 4!" : `🙋 Van ${van.length}/4`}${van.length ? ": " + van.map((i) => esc(nombre(i))).join(", ") : ""}</div>
    <div class="ppBotones">
      <button class="btn chico ${mio === "voy" ? "primario" : "claro"}" data-rsvp="${p.id}|voy">Voy</button>
      <button class="btn chico ${mio === "no" ? "negro" : "claro"}" data-rsvp="${p.id}|no">No puedo</button>
      ${botonWA(textoPlan(p), "📲")}
    </div>
  </section>`;
}

// ---------- Premio del mes ----------
const ajuste = (k) => st.ajustes.find((x) => x.clave === k)?.valor || "";
function bloquePremio() {
  const mes = hoyISO().slice(0, 7);
  const top = titulosDelDia((f) => f.startsWith(mes));
  const lider = top[0];
  const premio = ajuste("premio_mes") || "🍺 Una bebida invitada";
  return `<div class="premio">
    <div><small>🎁 PREMIO DEL MES · ${MESES[Number(mes.slice(5)) - 1].toUpperCase()}</small>
    <b>${esc(premio)}</b>
    <span>${lider ? `Va ganando <b>${esc(nombre(lider[0]))}</b> con ${lider[1]} día${lider[1] === 1 ? "" : "s"} de mejor jugador ⭐` : "El que más veces sea mejor jugador del día se lo lleva ⭐"}</span></div>
    ${st.esAdmin ? `<button class="btn chico claro" id="editarPremio">✏️</button>` : ""}
  </div>`;
}
async function editarPremio() {
  const nuevo = prompt("¿Cuál es el premio del mes?", ajuste("premio_mes"));
  if (nuevo === null) return;
  const { error: e } = await sb.from("ajustes").upsert({ clave: "premio_mes", valor: nuevo.trim() || "🍺 Una bebida invitada" });
  if (e) return error(e);
  toast("Premio actualizado 🎁"); cargarTodo();
}

// ---------- Fotos del partido ----------
const fotosDe = (partidoId) => st.recuerdos.filter((r) => r.partido_id === partidoId);
function filaFotosPartido(p) {
  const n = fotosDe(p.id).length;
  return `<div class="fotosPartido">
    <button class="enlace" data-album="${p.id}">📸 ${n ? `Ver ${n} foto${n === 1 ? "" : "s"} del partido` : "Fotos del partido"}</button>
    <label class="btn chico claro">+ Subir<input type="file" accept="image/*" multiple hidden data-subirpartido="${p.id}"></label>
  </div>`;
}
function verAlbum(partidoId) {
  const p = st.partidos.find((x) => x.id === partidoId);
  if (!p) return;
  const fotos = fotosDe(partidoId);
  const v = hoja(`
    <h3>📸 ${esPadel(p) ? "Pádel" : esc(tituloEvento(p))} · ${fechaLarga(p.fecha)}</h3>
    <p class="sub">Las fotos solo se ven aquí en la app 😉</p>
    ${fotos.length ? `<div class="galeria">${fotos.map((r) => `<button class="foto" data-foto="${r.id}"><img src="${esc(st.urls[r.ruta] || "")}" alt="" loading="lazy"></button>`).join("")}</div>` : `<p class="vacio">Todavía no hay fotos de este día.</p>`}
    <div class="botones">
      <label class="btn primario">+ Subir fotos<input type="file" accept="image/*" multiple hidden data-subirpartido="${p.id}"></label>
      <button class="btn" id="cerrar">Cerrar</button>
    </div>`, () => verAlbum(partidoId));
  $("#cerrar", v).onclick = cerrarHoja;
  v.querySelectorAll("[data-foto]").forEach((b) => (b.onclick = () => verFoto(st.recuerdos.find((r) => r.id === b.dataset.foto))));
}

// ---------- ¿Quién es más probable que…? ----------
function preguntaDelDia() {
  if (!st.preguntas.length) return null;
  const d = new Date();
  const dia = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
  return st.preguntas[(dia + d.getFullYear()) % st.preguntas.length].texto;
}
function tarjetaPregunta() {
  const texto = preguntaDelDia();
  if (!texto) return "";
  const hoy = hoyISO();
  const votos = st.votosPregunta.filter((v) => v.fecha === hoy);
  const mio = votos.find((v) => v.votante === st.yo);
  let cuerpo;
  if (!mio) {
    cuerpo = `<div class="chips grandes">${st.amigos.map((a) => `<button class="chip" data-pregunta="${a.id}">${esc(a.nombre)}</button>`).join("")}</div>
      <small class="sub">Vota para ver los resultados 👀</small>`;
  } else {
    const cuenta = {};
    for (const v of votos) cuenta[v.votado] = (cuenta[v.votado] || 0) + 1;
    const filas = Object.entries(cuenta).sort((a, b) => b[1] - a[1]);
    const max = filas[0]?.[1] || 1;
    cuerpo = `${filas.map(([id, n], i) => `<div class="barra ${i === 0 ? "top" : ""}"><span>${i === 0 ? "👑 " : ""}${esc(nombre(id))}</span><i style="width:${Math.round((n / max) * 100)}%"></i><b>${n}</b></div>`).join("")}
      <small class="sub">${votos.length} de ${st.amigos.length} han votado · tú votaste por ${esc(nombre(mio.votado))} · <button class="enlace mini" data-cambiarpregunta="1">cambiar</button></small>`;
  }
  return `<section class="tarjeta pregunta"><small class="etq">🤔 PREGUNTA DEL DÍA</small><h3>${esc(texto)}</h3>${cuerpo}</section>`;
}
async function votarPregunta(id) {
  if (!necesitoYo()) return;
  const fila = { fecha: hoyISO(), votante: st.yo, votado: id };
  const { error: e } = await sb.from("votos_pregunta").upsert(fila);
  if (e) return error(e);
  st.cambiandoPregunta = false;
  cargarTodo();
}

// ---------- Buzón de chismes anónimos ----------
function tarjetaChismes() {
  const publicados = st.chismes.filter((c) => c.publicado);
  const ultimos = publicados.slice(0, 2);
  return `<section class="tarjeta chismes">
    <div class="mesNav"><h2>🤫 Chismes</h2><button class="btn primario chico" data-chismes="1">Ver todos</button></div>
    <p class="sub" style="margin-top:-6px">Anónimos. Se publican todos juntos el viernes a las 20:00.${st.chismesPendientes ? ` <b>${st.chismesPendientes} esperando…</b> 👀` : ""}</p>
    ${ultimos.map((c) => `<div class="chisme">“${esc(c.texto)}”</div>`).join("")}
    <form id="fChisme" class="comForm"><input name="texto" maxlength="500" placeholder="Suelta tu chisme anónimo…" autocomplete="off"><button class="btn negro chico">Enviar</button></form>
  </section>`;
}
function enlazarChismes(raiz = document) {
  const f = $("#fChisme", raiz);
  if (!f) return;
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const texto = f.texto.value.trim();
    if (!texto) return;
    const { error: e } = await sb.from("chismes").insert({ texto });
    if (e) return error(e);
    f.reset(); toast("🤫 Chisme enviado. Nadie sabrá que fuiste tú.");
    st.chismesPendientes++; pintar();
  };
}
function verChismes() {
  const publicados = st.chismes.filter((c) => c.publicado);
  const pendientes = st.esAdmin ? st.chismes.filter((c) => !c.publicado) : [];
  const v = hoja(`
    <h3>🤫 Chismes de los Pendejos</h3>
    ${pendientes.length ? `<h4 class="subtitulo">⏳ Por publicar (solo tú los ves)</h4>
      ${pendientes.map((c) => `<div class="chisme pend">“${esc(c.texto)}” <button class="enlace mini" data-borrarchisme="${c.id}">borrar</button></div>`).join("")}
      <button class="btn negro ancho" id="publicarYa">📣 Publicar ya (sin esperar al viernes)</button>` : ""}
    <h4 class="subtitulo">Publicados</h4>
    ${publicados.length ? publicados.map((c) => `<div class="chisme"><small>${fechaCorta(c.creado_en.slice(0, 10))}</small>“${esc(c.texto)}”${st.esAdmin ? ` <button class="enlace mini" data-borrarchisme="${c.id}">borrar</button>` : ""}</div>`).join("") : `<p class="vacio">Todavía no hay chismes publicados.</p>`}
    <div class="botones"><button class="btn" id="cerrar">Cerrar</button></div>`, () => verChismes());
  $("#cerrar", v).onclick = cerrarHoja;
  v.querySelectorAll("[data-borrarchisme]").forEach((b) => (b.onclick = async () => {
    if (!confirm("¿Borrar este chisme?")) return;
    const { error: e } = await sb.from("chismes").delete().eq("id", b.dataset.borrarchisme);
    if (e) return error(e);
    cargarTodo();
  }));
  $("#publicarYa", v)?.addEventListener("click", async () => {
    const { error: e } = await sb.from("chismes").update({ publicado: true }).eq("publicado", false);
    if (e) return error(e);
    toast("🤫 ¡Chismes publicados!");
    enviarMensaje("🤫 ¡Nuevos chismes!", "Ya se publicaron los chismes anónimos. Entra a leerlos 👀").catch(() => {});
    cargarTodo();
  });
}

// ---------- Mini juego: "Pared" (pádel contra la pared) ----------
function recordsJuego() {
  const mejor = {};
  for (const p of st.puntuaciones) if (!mejor[p.amigo_id] || p.puntos > mejor[p.amigo_id]) mejor[p.amigo_id] = p.puntos;
  return Object.entries(mejor).sort((a, b) => b[1] - a[1]);
}
function seccionJuego() {
  const top = recordsJuego();
  const mio = top.find(([id]) => id === st.yo);
  return `<section class="tarjeta juegoCard">
    <div class="mesNav"><h2>🎮 Pádel contra la pared</h2><button class="btn primario" data-jugar="1">▶ Jugar</button></div>
    <p class="sub" style="margin-top:-6px">Mueve la pala con el dedo y no dejes caer la pelota. ¡A ver quién tiene el récord del grupo!</p>
    ${top.length ? `<table class="tabla"><tbody>${top.slice(0, 7).map(([id, pts], i) => `<tr><td>${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</td><td>${esc(nombre(id))}${id === st.yo ? ` <span class="tu">Tú</span>` : ""}</td><td><b>${pts}</b> golpes</td></tr>`).join("")}</tbody></table>`
      : `<p class="vacio">Nadie ha jugado todavía. ¡Pon el primer récord! 🏆</p>`}
    ${mio ? `<small class="sub">Tu récord: ${mio[1]} golpes</small>` : ""}
  </section>`;
}

function abrirJuego() {
  const div = document.createElement("div");
  div.className = "juego";
  div.innerHTML = `
    <div class="jCab"><b>🎾 Golpes: <span id="jPts">0</span></b><span>Récord: ${recordsJuego()[0]?.[1] || 0}</span><button id="jSalir">✕</button></div>
    <canvas id="jCanvas"></canvas>
    <div class="jInicio" id="jInicio"><h2>Pádel contra la pared</h2><p>Arrastra el dedo para mover la pala.<br>Cada golpe suma un punto y la pelota va cada vez más rápido. 🔥</p><button class="btn primario" id="jEmpezar">▶ Empezar</button></div>`;
  document.body.appendChild(div);
  document.body.classList.add("bloqueado");
  const cv = $("#jCanvas", div), ctx = cv.getContext("2d");
  let W, H, pala, bola, pts, vivo = false, raf;
  const ajustar = () => {
    const r = window.devicePixelRatio || 1;
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * r; cv.height = H * r; ctx.setTransform(r, 0, 0, r, 0, 0);
  };
  ajustar();
  const reiniciar = () => {
    pala = { x: W / 2, w: Math.max(80, W * 0.24), y: H - 60 };
    bola = { x: W / 2, y: H * 0.3, vx: (Math.random() > 0.5 ? 1 : -1) * 2.6, vy: 3.2, r: 9 };
    pts = 0; $("#jPts", div).textContent = 0;
  };
  const mover = (x) => { pala.x = Math.max(pala.w / 2, Math.min(W - pala.w / 2, x)); };
  cv.addEventListener("touchmove", (e) => { e.preventDefault(); mover(e.touches[0].clientX - cv.getBoundingClientRect().left); }, { passive: false });
  cv.addEventListener("touchstart", (e) => mover(e.touches[0].clientX - cv.getBoundingClientRect().left), { passive: true });
  cv.addEventListener("mousemove", (e) => mover(e.clientX - cv.getBoundingClientRect().left));

  const dibujar = () => {
    // pista
    ctx.fillStyle = "#1e5c8a"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, W - 20, H - 20);
    ctx.beginPath(); ctx.moveTo(10, H * 0.45); ctx.lineTo(W - 10, H * 0.45); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W / 2, H * 0.45); ctx.lineTo(W / 2, H - 10); ctx.stroke();
    // paredes de cristal
    ctx.fillStyle = "rgba(255,255,255,.12)"; ctx.fillRect(0, 0, W, 10); ctx.fillRect(0, 0, 10, H); ctx.fillRect(W - 10, 0, 10, H);
    // pala
    ctx.fillStyle = "#141413"; ctx.beginPath(); ctx.roundRect(pala.x - pala.w / 2, pala.y, pala.w, 14, 7); ctx.fill();
    ctx.fillStyle = "#d97757"; ctx.beginPath(); ctx.roundRect(pala.x - pala.w / 2 + 4, pala.y + 3, pala.w - 8, 8, 4); ctx.fill();
    // pelota
    ctx.fillStyle = "#d4f03a"; ctx.beginPath(); ctx.arc(bola.x, bola.y, bola.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(bola.x - 4, bola.y, bola.r - 2, -1, 1); ctx.stroke();
  };
  const paso = () => {
    bola.x += bola.vx; bola.y += bola.vy;
    if (bola.x < 10 + bola.r) { bola.x = 10 + bola.r; bola.vx *= -1; }
    if (bola.x > W - 10 - bola.r) { bola.x = W - 10 - bola.r; bola.vx *= -1; }
    if (bola.y < 10 + bola.r) { bola.y = 10 + bola.r; bola.vy *= -1; }
    if (bola.vy > 0 && bola.y + bola.r >= pala.y && bola.y + bola.r <= pala.y + 16 && Math.abs(bola.x - pala.x) <= pala.w / 2 + bola.r) {
      const off = (bola.x - pala.x) / (pala.w / 2);
      const v = Math.min(Math.hypot(bola.vx, bola.vy) * 1.06, 14);
      const ang = off * 1.0;
      bola.vx = v * Math.sin(ang); bola.vy = -Math.abs(v * Math.cos(ang));
      bola.y = pala.y - bola.r;
      pts++; $("#jPts", div).textContent = pts;
      pala.w = Math.max(56, pala.w - 1.5);
      if (navigator.vibrate) navigator.vibrate(10);
    }
    if (bola.y > H + 30) return fin();
    dibujar();
    raf = requestAnimationFrame(paso);
  };
  const fin = async () => {
    vivo = false;
    cancelAnimationFrame(raf);
    const record = recordsJuego()[0]?.[1] || 0;
    const miRecord = recordsJuego().find(([id]) => id === st.yo)?.[1] || 0;
    let msg = pts > record && pts > 0 ? "🏆 ¡NUEVO RÉCORD DEL GRUPO!" : pts > miRecord && pts > 0 ? "🔥 ¡Superaste tu récord!" : "¡Se te cayó! 😅";
    $("#jInicio", div).innerHTML = `<h2>${msg}</h2><p><b style="font-size:2.4rem">${pts}</b><br>golpes</p><button class="btn primario" id="jEmpezar">↻ Otra vez</button>`;
    $("#jInicio", div).hidden = false;
    $("#jEmpezar", div).onclick = empezar;
    if (pts > 0 && st.yo) {
      const { data } = await sb.from("puntuaciones").insert({ amigo_id: st.yo, puntos: pts, juego: "pong" }).select();
      if (data?.[0]) st.puntuaciones.push(data[0]);
      if (pts > record && record > 0) enviarChatSilencioso(`🎮 ¡Nuevo récord en Pádel contra la pared: ${pts} golpes! ¿Quién me gana? 😎`);
    }
  };
  const empezar = () => {
    reiniciar(); $("#jInicio", div).hidden = true; vivo = true; dibujar();
    setTimeout(() => { if (vivo) raf = requestAnimationFrame(paso); }, 400);
  };
  reiniciar(); dibujar();
  $("#jEmpezar", div).onclick = empezar;
  $("#jSalir", div).onclick = () => { vivo = false; cancelAnimationFrame(raf); div.remove(); document.body.classList.remove("bloqueado"); if (st.tab === "ranking") pintar(); };
}
async function enviarChatSilencioso(texto) {
  try { await sb.from("mensajes").insert({ autor: st.yo, texto }); } catch {}
}

// ---------- Vista de la pestaña Pádel ----------
function vistaPadel() {
  const recientes = st.partidos.filter((p) => esPadel(p) && yaPaso(p)).slice(-4).reverse();
  return `
    ${tarjetaProximoPadel()}
    ${st.extras ? bloquePremio() : ""}
    ${vistaRanking()}
    ${seccionCromos()}
    ${seccionJuego()}
    ${recientes.length ? `<section class="tarjeta"><h3>📸 Fotos de los partidos</h3>
      ${recientes.map((p) => `<div class="filaAlbum"><span>🎾 ${fechaLarga(p.fecha)}</span>${filaFotosPartido(p)}</div>`).join("")}
    </section>` : ""}`;
}

// ---------- Cromos: foto de cada uno jugando pádel ----------
function seccionCromos() {
  const yo = st.amigos.find((a) => a.id === st.yo);
  const rank = calcularRanking("todo").tabla;
  return `<section class="tarjeta">
    <div class="mesNav"><h2>🃏 Los jugadores</h2>${yo ? `<label class="btn primario chico">${yo.foto_padel_ruta ? "📷 Cambiar mi foto" : "📷 Subir mi foto"}<input type="file" accept="image/*" hidden id="subirCromo"></label>` : ""}</div>
    <p class="sub" style="margin-top:-6px">Cada quien sube una foto jugando pádel. 🎾</p>
    <div class="cromos">${st.amigos.map((a) => {
      const url = a.foto_padel_ruta && st.urls[a.foto_padel_ruta];
      const r = rank.find((x) => x.id === a.id);
      return `<button class="cromo" data-perfil="${a.id}">
        <div class="cromoFoto" ${url ? `style="background-image:url('${esc(url)}')"` : ""}>${url ? "" : `<span>🎾</span>`}</div>
        <b>${esc(a.nombre)}</b>
        <small>${a.apodo ? `“${esc(a.apodo)}”` : a.posicion ? POSICIONES[a.posicion] : "&nbsp;"}</small>
        <i>${r ? `🏆 ${r.g} · ${r.pct}%` : "Sin partidos"}</i>
      </button>`;
    }).join("")}</div>
  </section>`;
}
async function subirCromo(file) {
  try {
    toast("Subiendo tu foto… 🎾");
    const yo = st.amigos.find((a) => a.id === st.yo);
    const ruta = await subirImagen(file, "padel", 900);
    const { error: e } = await sb.from("amigos").update({ foto_padel_ruta: ruta }).eq("id", st.yo);
    if (e) throw e;
    if (yo?.foto_padel_ruta) sb.storage.from(BUCKET).remove([yo.foto_padel_ruta]);
    toast("¡Foto de pádel lista! 📸"); cargarTodo();
  } catch (err) { error(err); }
}

iniciar();
