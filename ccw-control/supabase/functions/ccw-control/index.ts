// CCW Control · panel del negocio servido desde Supabase.
// - Sirve la página (HTML publicado en GitHub, cacheado en memoria) protegida por un PIN de equipo (cookie).
// - /estado devuelve el estado calculado en el momento: base (tabla ccw_control, fila "base") + Supabase en vivo.
// - El PIN del equipo es el secreto CCW_CONTROL_PIN de la función (o, si no existe, la fila "acceso" de la tabla).
// - Si la tabla no tiene fila "base", usa el estado base incrustado en base.ts (finanzas y configuración al desplegar).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { fusionar } from "./fusion.ts";
import { BASE } from "./base.ts";

const FN = "ccw-control";
const COOKIE = "ccw_control";
const PAGE_URL = Deno.env.get("CCW_PAGE_URL") || "https://raw.githubusercontent.com/paablocolomeer/claude/main/ccw-control/page.html";
const LOCAL = Deno.env.get("CCW_LOCAL_DIR") || ""; // solo para pruebas locales: lee base.json, supa.json y pin.txt de esa carpeta

const sb = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

let pageCache: { html: string; t: number } | null = null;
async function getPage(): Promise<string> {
  if (LOCAL) return await Deno.readTextFile(`${LOCAL}/page.html`);
  if (pageCache && Date.now() - pageCache.t < 10 * 60_000) return pageCache.html;
  const r = await fetch(PAGE_URL, { headers: { "cache-control": "no-cache" } });
  if (!r.ok) { if (pageCache) return pageCache.html; throw new Error(`No se ha podido cargar la página (${r.status})`); }
  const html = await r.text(); pageCache = { html, t: Date.now() }; return html;
}
async function getRow(id: string): Promise<any> {
  const { data, error } = await sb().from("ccw_control").select("data").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? data.data : null;
}
async function loadBase(): Promise<any> { if (LOCAL) return JSON.parse(await Deno.readTextFile(`${LOCAL}/base.json`)); let row: any = null; try { row = await getRow("base"); } catch (_) { row = null; } return row || BASE; }
async function loadPin(): Promise<string> {
  if (LOCAL) return (await Deno.readTextFile(`${LOCAL}/pin.txt`)).trim();
  const env = (Deno.env.get("CCW_CONTROL_PIN") || "").trim(); if (env) return env;
  try { const a = await getRow("acceso"); return a && a.pin ? String(a.pin).trim() : ""; } catch (_) { return ""; }
}
async function loadSupa(): Promise<any> {
  if (LOCAL) return JSON.parse(await Deno.readTextFile(`${LOCAL}/supa.json`));
  const { data, error } = await sb().rpc("ccw_control_supabase");
  if (error) throw new Error(error.message);
  return typeof data === "string" ? JSON.parse(data) : data;
}

async function token(pin: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("ccw-control-v1"));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}
function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  (req.headers.get("cookie") || "").split(";").forEach((p) => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const redirect = (to: string, cookie?: string) => { const h = new Headers({ Location: to, "Cache-Control": "no-store" }); if (cookie) h.set("Set-Cookie", cookie); return new Response(null, { status: 303, headers: h }); };
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const html = (body: string, status = 200, cookie?: string) => { const h = new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" }); if (cookie) h.set("Set-Cookie", cookie); return new Response(body, { status, headers: h }); };

function loginPage(error: boolean, status = 200): Response {
  return html(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CCW Control</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800&family=Poppins:wght@400;500;600&display=swap">
<style>
:root{color-scheme:light}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#012f22;font:15px/1.5 Poppins,system-ui,sans-serif;color:#0f1f19}
.card{background:#fff;border-radius:18px;padding:34px 34px 30px;width:min(380px,calc(100vw - 32px));box-shadow:0 30px 80px -30px rgba(0,0,0,.6);box-sizing:border-box}
h1{font:800 22px/1.2 Montserrat,system-ui,sans-serif;margin:0 0 4px;color:#012f22}.sub{color:#5b6660;font-size:13px;margin:0 0 22px}
label{display:block;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#5b6660;margin-bottom:6px}
input{width:100%;box-sizing:border-box;font:600 20px/1 Poppins,system-ui,sans-serif;letter-spacing:.2em;padding:12px 14px;border:1px solid #c9d4cd;border-radius:10px;outline:none}
input:focus{border-color:#f0ab1f;box-shadow:0 0 0 3px rgba(240,171,31,.25)}
button{margin-top:14px;width:100%;font:600 14px Poppins,system-ui,sans-serif;background:#f0ab1f;color:#012f22;border:0;border-radius:10px;padding:12px;cursor:pointer}
.err{color:#b42318;font-size:13px;margin:10px 0 0}.foot{margin-top:18px;font-size:11px;color:#8a948f}
</style></head><body><form class="card" method="post" action="entrar" autocomplete="off">
<h1>CCW Control</h1><p class="sub">Panel del negocio de Corporate Car Wash</p>
<label for="pin">PIN del equipo</label><input id="pin" name="pin" type="password" inputmode="numeric" autofocus required>
${error ? '<p class="err">PIN incorrecto.</p>' : ""}
<button type="submit">Entrar</button>
<p class="foot">Acceso reservado al equipo de CCW. Los datos se leen de Supabase en el momento de abrir.</p>
</form></body></html>`, status);
}

Deno.serve(async (req: Request) => {
  try {
    const url = new URL(req.url); const path = url.pathname;
    const i = path.indexOf("/" + FN);
    const internalBase = i >= 0 ? path.slice(0, i + FN.length + 1) : path.replace(/\/+$/, "");
    const sub = i >= 0 ? path.slice(internalBase.length) : "/";
    const visibleBase = (internalBase.startsWith("/functions/v1") ? "" : "/functions/v1") + internalBase;
    const home = visibleBase + "/";

    const pin = await loadPin();
    if (!pin) return html("<!doctype html><meta charset=utf-8><title>CCW Control</title><body style=\"font:15px system-ui;padding:40px;color:#0f1f19\"><h2>CCW Control</h2><p>Falta configurar el PIN del equipo: añade el secreto <code>CCW_CONTROL_PIN</code> a la función <code>ccw-control</code> en Supabase (Edge Functions → Secrets).</p></body>", 200);
    const tok = await token(pin);
    const authed = !!pin && cookies(req)[COOKIE] === tok;
    const setCookie = `${COOKIE}=${tok}; Path=${visibleBase}; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`;
    const clearCookie = `${COOKIE}=; Path=${visibleBase}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
    const qpin = url.searchParams.get("pin");

    if (sub === "/salir") return redirect(home, clearCookie);
    if (req.method === "POST" && sub === "/entrar") {
      const form = await req.formData(); const p = String(form.get("pin") || "").trim();
      if (pin && p === pin) return redirect(home, setCookie);
      await sleep(700); return loginPage(true, 200);
    }
    if (sub === "/estado") {
      const ok = authed || (!!pin && qpin !== null && qpin === pin);
      if (!ok) return json({ error: "no autorizado" }, 401);
      const [base, supa] = await Promise.all([loadBase(), loadSupa()]);
      if (!base) return json({ error: "falta el estado base en la tabla ccw_control" }, 500);
      return json(fusionar(base, supa));
    }
    if (qpin !== null) { if (pin && qpin === pin) return redirect(home, setCookie); await sleep(700); return loginPage(true, 200); }
    if (sub === "") return redirect(home);
    if (!authed) return loginPage(false, 200);
    if (sub === "/" || sub === "/index.html") return html(await getPage());
    return new Response("No encontrado", { status: 404, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return new Response("CCW Control: error al preparar la página. " + ((e as Error).message || e), { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
});
