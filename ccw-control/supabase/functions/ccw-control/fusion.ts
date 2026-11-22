// CCW Control · fusiona el estado base (tabla ccw_control, fila "base") con la extracción en vivo de Supabase
// (función SQL ccw_control_supabase).
//
// 22/11/2026: la lista de edificios, su estado (activo / pendiente) y los periodos en los que
// se ha dado servicio los decide la fila "base" (los mantiene el agente CCW), no Supabase.
// Antes, un edificio abierto en la web (Cristalia) pasaba solo a "activo" con todas sus plazas
// y hundía la conversión aunque todavía no se lavara allí.
// - edificios[].claves: palabras que identifican el edificio en buildings.name de Supabase.
// - edificios[].periodos: [{desde, hasta|null, plazas}] días con servicio. Fuera de ellos las
//   plazas no cuentan para la conversión (plazas_hist se genera desde aquí, con 0 en las pausas).

// Palabras por defecto si la fila base no trae "claves"
const MAPA: Record<string, string[]> = {
  cubos: ["cubos"], ontier: ["ontier", "habana"], cristalia: ["cristalia"], ruizpicasso: ["ruiz picasso", "picasso", "merlin"],
};
const RECOGIDA: Record<string, string> = { recepcion: "recepción", taquillas: "taquillas", taquilla: "taquillas", porteria: "portería", "portería": "portería" };

function edificioId(name: unknown, estado: any): string | null {
  const n = String(name || "").toLowerCase();
  for (const e of estado.edificios) {
    const claves: string[] = Array.isArray(e.claves) && e.claves.length ? e.claves : (MAPA[e.id] || [e.id]);
    for (const kw of claves) if (n.includes(String(kw).toLowerCase())) return e.id;
  }
  return null;
}

function diaSiguiente(iso: string): string {
  const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10);
}

// periodos de servicio -> plazas_hist con 0 en las pausas
function plazasHist(periodos: any[]): [string, number][] {
  const ps = periodos.filter((p) => p && p.desde).sort((a, b) => String(a.desde).localeCompare(String(b.desde)));
  const out: [string, number][] = [];
  for (const p of ps) {
    out.push([String(p.desde).slice(0, 10), Number(p.plazas || 0)]);
    if (p.hasta) out.push([diaSiguiente(String(p.hasta).slice(0, 10)), 0]);
  }
  return out;
}

function monthRange(a: string, b: string): string[] {
  let [y, m] = a.split("-").map(Number); const out: string[] = [];
  for (;;) {
    const s = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`; out.push(s);
    if (s >= b) return out;
    m++; if (m === 13) { m = 1; y++; }
  }
}

export function fusionar(baseIn: any, supa: any, ahora = new Date()): any {
  const estado = JSON.parse(JSON.stringify(baseIn));
  for (const k of ["reservas", "registros", "edificios", "trabajadores"]) if (!(k in supa)) throw new Error(`La extracción de Supabase no trae "${k}"`);
  const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", ...opts }).format(ahora);
  const hoy: string = supa.hoy || (() => { const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora); return p; })();
  const avisos: string[] = [];

  // edificios: la ficha (estado, plazas, periodos) es la de la fila base; de Supabase solo la recogida de llaves
  const supById: Record<string, any> = {};
  for (const b of supa.edificios) {
    const eid = edificioId(b.name, estado);
    if (!eid) { avisos.push(`Edificio en Supabase sin ficha en CCW Control: ${b.name} (${b.plazas} plazas). Hay que darle de alta en el estado.`); continue; }
    supById[eid] = b;
  }
  for (const e of estado.edificios) {
    if (Array.isArray(e.periodos) && e.periodos.length) e.plazas_hist = plazasHist(e.periodos);
    const b = supById[e.id]; if (!b) continue;
    const plazas = Number(b.plazas || 0);
    if (plazas > 0 && e.plazas && plazas !== Number(e.plazas)) avisos.push(`${e.nombre}: Supabase dice ${plazas} plazas y CCW Control ${e.plazas}. Díselo al agente si ha cambiado.`);
    if (b.recogida) e.recogida = RECOGIDA[String(b.recogida).toLowerCase()] || String(b.recogida);
  }

  // reservas: [mes, edificio_id, cliente_idx, ok, final, pagado, devuelto, fecha]
  const clientes = new Map<string, number>(); const reservas: any[] = []; let fuera = 0; const porWorker: Record<string, number> = {};
  for (const fila of supa.reservas) {
    const [cli, edName, fecha, status, final, worker, pagado, devuelto] = fila;
    const eid = edificioId(edName, estado); if (!eid) { fuera++; continue; }
    if (!clientes.has(cli)) clientes.set(cli, clientes.size);
    const ok = String(status).toLowerCase() === "cancelled" ? 0 : 1;
    reservas.push([String(fecha).slice(0, 7), eid, clientes.get(cli), ok, Math.round(Number(final || 0) * 100) / 100, Math.round(Number(pagado || 0) * 100) / 100, Math.round(Number(devuelto || 0) * 100) / 100, fecha]);
    if (ok && worker) { const k = String(worker).trim().toLowerCase(); porWorker[k] = (porWorker[k] || 0) + 1; }
  }
  const pendientes = new Set((estado.edificios || []).filter((e: any) => e.tipo !== "activo").map((e: any) => e.id));
  const enPendientes: Record<string, number> = {};
  for (const r of reservas) if (pendientes.has(r[1]) && r[3] === 1) enPendientes[r[1]] = (enPendientes[r[1]] || 0) + 1;
  for (const [id, n] of Object.entries(enPendientes)) {
    const e = estado.edificios.find((x: any) => x.id === id);
    avisos.push(`${n} reserva${n > 1 ? "s" : ""} en ${e ? e.nombre : id}, que en CCW Control sigue sin empezar. Díselo al agente para abrir su periodo de servicio.`);
  }
  const antes = (estado.reservas || []).length;
  estado.reservas = reservas;
  if (fuera) avisos.push(`${fuera} reservas de edificios sin ficha en CCW Control se han dejado fuera.`);

  // registros: [mes, edificio_id, n]
  estado.registros = supa.registros.map(([m, n, k]: any[]) => [m, edificioId(n, estado), Number(k)]).filter((r: any[]) => r[1]);

  // trabajadores
  const supW: Record<string, any> = {}; for (const w of supa.trabajadores) supW[String(w.full_name || "").trim().toLowerCase()] = w;
  for (const w of estado.trabajadores || []) {
    const key = String(w.nombre).trim().toLowerCase();
    w.lav_hist = porWorker[key] || 0;
    const sw = supW[key];
    if (sw) {
      const nv = Number(sw.n_valoraciones || 0); w.n_valoraciones = nv;
      w.estrellas = nv && sw.estrellas != null ? Math.round(Number(sw.estrellas) * 100) / 100 : null;
      if (sw.is_active === false && w.activo) avisos.push(`${w.nombre} aparece inactivo en Supabase; en CCW Control sigue activo (no se cambia solo).`);
    }
  }

  // calendario
  estado.hoy = hoy; const mesActual = hoy.slice(0, 7);
  const meses: any[] = estado.meses || [];
  if (meses.length) {
    const existentes = new Set(meses.map((m: any) => m.m));
    const plantilla: any = {}; for (const [k, v] of Object.entries(meses[meses.length - 1])) plantilla[k] = (typeof v === "number") ? 0 : v;
    for (const m of monthRange(meses[meses.length - 1].m, mesActual)) {
      if (!existentes.has(m)) { meses.push({ ...plantilla, m, partial: true }); existentes.add(m); avisos.push(`Mes ${m} abierto en Finanzas sin movimientos todavía: pásame el Excel o conecta Holded para cerrarlo.`); }
    }
    for (const m of meses) m.partial = (m.m === mesActual);
  }
  estado.meses = meses;
  estado.rango_datos = { ...(estado.rango_datos || {}), hasta: mesActual };
  estado.updated_at = fmt({ day: "2-digit", month: "2-digit", year: "numeric" }) + " " + fmt({ hour: "2-digit", minute: "2-digit", hour12: false });
  estado.ultima_sync = { supabase: supa.generado || null, reservas: reservas.length, reservas_antes: antes, clientes: clientes.size, avisos, en_vivo: true };
  return estado;
}
