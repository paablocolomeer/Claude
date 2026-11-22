# CCW Control

Panel del negocio de Corporate Car Wash.

- **Página:** `index.html`, publicada con GitHub Pages en https://paablocolomeer.github.io/Claude/ccw-control/ (sin datos: pide el PIN del equipo y lee los datos en vivo).
- **API:** edge function `ccw-control` del proyecto Supabase de CCW (`supabase/functions/ccw-control/`): `/estado` devuelve el estado fusionado (base + Supabase en vivo) si la cabecera `X-CCW-PIN` lleva el PIN del equipo; `/` redirige a la página.
- **Base de datos:** `supabase/migrations/` crea la tabla `ccw_control` (filas `base` y `acceso`) y la función SQL `ccw_control_supabase()` con las exclusiones fijas.
- **Estado base (fila `base`):** única fuente de edificios, operarios, objetivos y finanzas del Excel. La mantiene el agente CCW. `estado-base.json` es la copia de referencia (22/11/2026) para restaurarla; la función ya no lleva copia propia.
- **Edificios y pausas:** cada edificio trae `claves` (cómo se llama en Supabase) y `periodos` de servicio `[{desde, hasta, plazas}]`. Fuera de esos días sus plazas no cuentan para la conversión. Un edificio `pendiente` no entra en las métricas aunque esté abierto en la web; pasa a `activo` solo cuando el agente le abre su periodo.

Supabase no sirve HTML desde su dominio (lo reescribe como texto plano), por eso la página vive aquí y la función solo da datos.

Generado por el agente CCW desde `template.html`; la misma plantilla produce la versión autónoma (`CCW_Control.html`) y la publicada en Claude.
- **Finanzas:** no se leen en vivo; salen del "Excel Financiero CCW" (Drive). Para pasarlas: descargar el Excel como .xlsx y `python3 -I sync_finanzas.py excel.xlsx estado-base.json nueva.json`, revisar lo que imprime (gastos nuevos y quitados; si alguna categoría no encaja se para) y guardar `movimientos`, `meses`, `rango_datos` y `notas_finanzas` de `nueva.json` en la fila `base`.
