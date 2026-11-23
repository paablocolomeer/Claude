// CCW 23/11/2026: resumen del CRM comercial (tabla crm_estado del mismo Supabase) para CCW Control.
// Solo cifras y nombres de edificios: los contactos y las notas del CRM no salen de aquí.
const ETAPAS: { id: string; nombre: string; pipeline: "pre" | "post"; cerrada?: boolean }[] = [
  { id: "pendiente", nombre: "Pendiente de contactar", pipeline: "pre" },
  { id: "contactado", nombre: "Contactado", pipeline: "pre" },
  { id: "reunion", nombre: "Reunión cerrada", pipeline: "pre" },
  { id: "interesado", nombre: "Interesado", pipeline: "post" },
  { id: "pendiente_firma", nombre: "Pendiente de firma", pipeline: "post" },
  { id: "firmado", nombre: "Firmado", pipeline: "post", cerrada: true },
  { id: "no_interesado", nombre: "No interesado", pipeline: "pre", cerrada: true },
  { id: "caido", nombre: "Cliente caído", pipeline: "post", cerrada: true },
];

const sumarDias = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const norm = (s: string) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/\b(edificio|torre|de|del|la|los|las|el)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

export function resumenCRM(d: any, base: any, hoy: string) {
  if (!d || !Array.isArray(d.cuentas)) return null;
  const aj = d.ajustes || {};
  const dias = Number(aj.diasHastaEntrada ?? 11);
  const tasa = Number(aj.tasaUso ?? 4) / 100;
  const precio = Number(aj.precioLavado ?? 0);
  const valor = (plazas: number) => Math.round((Number(plazas) || 0) * tasa * precio);
  const entrada = (c: any) => c.fechaEntrada || (c.fechaFirma ? sumarDias(c.fechaFirma, dias) : null);
  const firma = (c: any) => c.fechaFirma || ((c.historial || []).filter((h: any) => h.etapa === "firmado").pop()?.en || "").slice(0, 10) || null;

  const etapas = ETAPAS.map((e) => {
    const cs = d.cuentas.filter((c: any) => c.etapa === e.id);
    const plazas = cs.reduce((s: number, c: any) => s + (Number(c.plazas) || 0), 0);
    return { id: e.id, nombre: e.nombre, pipeline: e.pipeline, cerrada: !!e.cerrada, cuentas: cs.length, plazas, valor: valor(plazas) };
  });
  const abiertas = d.cuentas.filter((c: any) => !ETAPAS.find((e) => e.id === c.etapa)?.cerrada);
  const plazasAbiertas = abiertas.reduce((s: number, c: any) => s + (Number(c.plazas) || 0), 0);

  // Edificios que ya tiene CCW Control (fila base), para avisar de firmados sin ficha.
  const enPanel = (nombre: string) => {
    const n = norm(nombre);
    return (base?.edificios || []).some((e: any) => {
      const cands = [e.nombre, e.name, e.clave, ...(Array.isArray(e.claves) ? e.claves : [])].filter(Boolean).map(norm);
      return cands.some((m: string) => m && (m === n || m.includes(n) || n.includes(m)));
    });
  };

  const firmados = d.cuentas.filter((c: any) => c.etapa === "firmado").map((c: any) => ({
    nombre: c.nombre, plazas: Number(c.plazas) || 0, firma: firma(c), entrada: entrada(c), valor: valor(c.plazas), enPanel: enPanel(c.nombre),
  })).sort((a: any, b: any) => String(b.firma || "").localeCompare(String(a.firma || "")));

  const proximasFirmas = d.cuentas.filter((c: any) => c.etapa === "pendiente_firma")
    .map((c: any) => ({ nombre: c.nombre, plazas: Number(c.plazas) || 0, firma: c.fechaFirma || null, valor: valor(c.plazas) }))
    .sort((a: any, b: any) => String(a.firma || "9").localeCompare(String(b.firma || "9")));

  const proximasEntradas = firmados.filter((f: any) => f.entrada && f.entrada >= hoy).sort((a: any, b: any) => a.entrada.localeCompare(b.entrada));

  const fus = Array.isArray(d.followups) ? d.followups.filter((f: any) => !f.hecho) : [];
  const fuVencidos = fus.filter((f: any) => String(f.fecha || "").slice(0, 10) < hoy).length;
  const fuHoy = fus.filter((f: any) => String(f.fecha || "").slice(0, 10) === hoy).length;

  // Solo firmas recientes o por venir: las antiguas que se quitaron del panel a propósito no avisan.
  const avisos: string[] = firmados.filter((f: any) => !f.enPanel && f.entrada && f.entrada >= sumarDias(hoy, -30))
    .map((f: any) => `${f.nombre} está firmado en el CRM${f.entrada ? ` (entrada ${f.entrada.split("-").reverse().join("/")})` : ""} pero no tiene ficha en CCW Control. Díselo al agente para darlo de alta.`);

  return {
    cuentas: d.cuentas.length,
    abiertas: abiertas.length,
    plazasAbiertas,
    valorAbierto: valor(plazasAbiertas),
    precioLavado: precio,
    tasaUso: Number(aj.tasaUso ?? 4),
    datosReales: aj.datosReales !== false && !!aj.reales,
    etapas,
    firmados,
    proximasFirmas,
    proximasEntradas,
    followups: { pendientes: fus.length, vencidos: fuVencidos, hoy: fuHoy },
    avisos,
  };
}
