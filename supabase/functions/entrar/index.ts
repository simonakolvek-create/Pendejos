// Inicio de sesión sencillo: eliges tu nombre + código del grupo.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(URL_SB, SERVICIO, { auth: { persistSession: false, autoRefreshToken: false } });

async function config() {
  const { data, error } = await admin.from("config_privada").select("clave, valor");
  if (error) throw error;
  return Object.fromEntries(data.map((x) => [x.clave, x.valor]));
}

async function hmac(secreto: string, texto: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const f = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texto)));
  return [...f].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));

    // Lista de nombres para la pantalla de entrada
    if (body.accion === "nombres") {
      const { data, error } = await admin.from("amigos").select("id, nombre").order("nombre");
      if (error) throw error;
      return json({ nombres: data });
    }

    // Entrar
    const { amigo_id, codigo } = body;
    if (!amigo_id || !codigo) return json({ error: "Falta tu nombre o el código" }, 400);
    const { data: amigo } = await admin.from("amigos").select("*").eq("id", amigo_id).maybeSingle();
    if (!amigo) return json({ error: "No encontramos ese nombre" }, 404);

    const c = await config();
    const esperado = amigo.es_admin ? c.CODIGO_ADMIN : c.CODIGO_GRUPO;
    if (String(codigo).trim().toLowerCase() !== String(esperado).toLowerCase()) {
      await new Promise((r) => setTimeout(r, 800)); // frena intentos repetidos
      return json({ error: "Código incorrecto" }, 401);
    }

    const email = `${amigo.id}@pendejos.app`;
    const password = await hmac(c.SECRETO_CLAVES, amigo.id);

    if (!amigo.usuario) {
      const { data: creado, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nombre: amigo.nombre } });
      let uid = creado?.user?.id;
      if (error) {
        // ya existía: buscarlo
        const { data: lista } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        uid = lista?.users.find((u) => u.email === email)?.id;
        if (!uid) throw error;
      }
      await admin.from("amigos").update({ usuario: uid }).eq("id", amigo.id);
    }

    const cliente = createClient(URL_SB, SERVICIO, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: ses, error: e2 } = await cliente.auth.signInWithPassword({ email, password });
    if (e2) throw e2;
    return json({ access_token: ses.session!.access_token, refresh_token: ses.session!.refresh_token });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message || "Error" }, 500);
  }
});
