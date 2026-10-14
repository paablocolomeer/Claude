// CCW Control · API del panel del negocio (Supabase Edge Function).
// - La página vive en GitHub Pages (PAGES_URL); Supabase no sirve HTML desde su dominio, así que "/" redirige allí.
// - /estado devuelve el estado calculado en el momento: base (tabla ccw_control, fila "base", o base.ts) + Supabase en vivo.
//   Requiere el PIN del equipo en la cabecera X-CCW-PIN (la página lo guarda en el navegador), en ?pin= o en la cookie.
// - El PIN es el secreto CCW_CONTROL_PIN de la función o, si no existe, la fila "acceso" de la tabla ccw_control.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { fusionar } from "./fusion.ts";
import { BASE } from "./base.ts";

const FN = "ccw-control";
const COOKIE = "ccw_control";
const PAGE_URL = Deno.env.get("CCW_PAGE_URL") || "https://raw.githubusercontent.com/paablocolomeer/claude/main/ccw-control/index.html";
const PAGES_URL = Deno.env.get("CCW_PAGES_URL") || "https://paablocolomeer.github.io/Claude/ccw-control/";
const CORS: Record<string, string> = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "x-ccw-pin, content-type", "Access-Control-Max-Age": "86400", "Vary": "Origin" };
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
// PINs válidos: el secreto CCW_CONTROL_PIN (uno o varios separados por comas) y la fila "acceso" de la tabla ({"pin": "...", "pines": ["...", "..."]}); cada persona puede tener el suyo
async function loadPins(): Promise<string[]> {
  const out: string[] = [];
  const add = (v: unknown) => { const s = String(v ?? "").trim(); if (s && !out.includes(s)) out.push(s); };
  if (LOCAL) { (await Deno.readTextFile(`${LOCAL}/pin.txt`)).split(/[\s,]+/).forEach(add); return out; }
  (Deno.env.get("CCW_CONTROL_PIN") || "").split(",").forEach(add);
  try { const a = await getRow("acceso"); if (a) { add(a.pin); if (Array.isArray(a.pines)) a.pines.forEach(add); } } catch (_) { /* sin fila: solo el secreto */ }
  return out;
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
const redirect = (to: string, cookie?: string) => { const h: Record<string, string> = { "Location": to, "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" }; if (cookie) h["Set-Cookie"] = cookie; return new Response("", { status: 303, headers: h }); };
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS } });
const html = (body: string, status = 200, cookie?: string) => { const h: Record<string, string> = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }; if (cookie) h["Set-Cookie"] = cookie; const res = new Response(body, { status, headers: h }); res.headers.set("Content-Type", "text/html; charset=utf-8"); return res; };

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
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url); const path = url.pathname;
    const i = path.indexOf("/" + FN);
    const internalBase = i >= 0 ? path.slice(0, i + FN.length + 1) : path.replace(/\/+$/, "");
    const sub = i >= 0 ? path.slice(internalBase.length) : "/";
    const visibleBase = (internalBase.startsWith("/functions/v1") ? "" : "/functions/v1") + internalBase;
    const home = visibleBase + "/";

    const pins = await loadPins();
    if (!pins.length) return html("<!doctype html><meta charset=utf-8><title>CCW Control</title><body style=\"font:15px system-ui;padding:40px;color:#0f1f19\"><h2>CCW Control</h2><p>Falta configurar el PIN del equipo: añade el secreto <code>CCW_CONTROL_PIN</code> a la función <code>ccw-control</code> en Supabase (Edge Functions → Secrets).</p></body>", 200);
    const toks = await Promise.all(pins.map(token));
    const authed = toks.includes(cookies(req)[COOKIE] || "");
    const valido = (p: string | null) => p !== null && p !== "" && pins.includes(p);
    const setCookie = async (p: string) => `${COOKIE}=${await token(p)}; Path=${visibleBase}; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`;
    const clearCookie = `${COOKIE}=; Path=${visibleBase}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
    const qpin = url.searchParams.get("pin");

    if (sub === "/salir") return redirect(home, clearCookie);
    if (req.method === "POST" && sub === "/entrar") {
      const form = await req.formData(); const p = String(form.get("pin") || "").trim();
      if (valido(p)) return redirect(home, await setCookie(p));
      await sleep(700); return loginPage(true, 200);
    }
    if (sub === "/estado") {
      const hpin = (req.headers.get("x-ccw-pin") || "").trim();
      const ok = authed || valido(qpin) || valido(hpin);
      if (!ok) return json({ error: "no autorizado" }, 401);
      const [base, supa] = await Promise.all([loadBase(), loadSupa()]);
      if (!base) return json({ error: "falta el estado base en la tabla ccw_control" }, 500);
      return json(fusionar(base, supa));
    }
    if (qpin !== null) { if (valido(qpin)) return redirect(home, await setCookie(qpin)); await sleep(700); return loginPage(true, 200); }
    if (sub === "" || sub === "/" || sub === "/index.html") return redirect(PAGES_URL);
    if (sub === "/pagina") { if (!authed) return loginPage(false, 200); return html(await getPage()); }
    return new Response("No encontrado", { status: 404, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return new Response("CCW Control: error al preparar la página. " + ((e as Error).message || e), { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
});
