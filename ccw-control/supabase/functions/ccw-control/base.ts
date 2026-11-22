// Estado base de CCW Control: vive SOLO en la tabla ccw_control, fila "base" (la mantiene el agente CCW).
// Antes aquí había una copia de respaldo y se quedó vieja (edificios y operario de octubre); para que no vuelva
// a pasar ya no hay copia: si falta la fila, /estado responde con un error claro en vez de enseñar datos antiguos.
// Copia de referencia para restaurar la fila: ccw-control/estado-base.json.
export const BASE: any = null;
