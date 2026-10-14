// CCW Control · fusiona el estado base (tabla ccw_control, fila "base") con la extracción en vivo de Supabase
// (función SQL ccw_control_supabase). Misma lógica que refresh.py de la actualización diaria.

// id del edificio en CCW Control -> palabras que lo identifican en buildings.name
const MAPA: Record<string, string[]> = {
  cubos: ["cubos"], ontier: ["ontier", "habana"], cristalia: ["cristalia"], fujitsu: ["fujitsu"],
  merlin: ["merlin", "castellana 257"], gmp: ["gmp"],
};
const RECOGIDA: Record<string, string> = { recepcion: "recepción", taquillas: "taquillas", taquilla: "taquillas", porteria: "portería", "portería": "portería" };

function edificioId(name: unknown, estado: any): string | null {
  const n = String(name || "").toLowerCase();
  for (const e of estado.edificios) {
    for (const kw of (MAPA[e.id] || [e.id])) if (n.includes(kw)) return e.id;
  }
  return null;
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

  // edificios: plazas, alta y estado según Supabase
  const supById: Record<string, any> = {};
  for (const b of supa.edificios) {
    const eid = edificioId(b.name, estado);
    if (!eid) { avisos.push(`Edificio en Supabase sin ficha en CCW Control: ${b.name} (${b.plazas} plazas). Hay que darle de alta en el estado.`); continue; }
    supById[eid] = b;
  }
  for (const e of estado.edificios) {
    const b = supById[e.id]; if (!b) continue;
    const plazas = Number(b.plazas || 0);
    if (e.tipo === "pendiente" && b.activo && plazas > 0) {
      const alta = String(b.alta || hoy).slice(0, 10);
      e.tipo = "activo"; e.alta = alta.slice(0, 7); e.plazas = plazas; e.plazas_hist = [[alta, plazas]];
      avisos.push(`${e.nombre} ya está en Supabase: pasa a activo con ${plazas} plazas desde ${alta}.`);
    } else if (plazas > 0 && plazas !== e.plazas) {
      if (!e.plazas_hist) e.plazas_hist = [[(e.alta && String(e.alta).length === 7) ? e.alta + "-01" : hoy, e.plazas]];
      e.plazas_hist.push([hoy, plazas]);
      avisos.push(`${e.nombre}: plazas ${e.plazas} → ${plazas}.`);
      e.plazas = plazas;
    }
    if (e.tipo === "activo" && b.recogida) e.recogida = RECOGIDA[String(b.recogida).toLowerCase()] || String(b.recogida);
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
