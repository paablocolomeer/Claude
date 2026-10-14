# CCW Control

Panel del negocio de Corporate Car Wash.

- **Página:** `index.html`, publicada con GitHub Pages en https://paablocolomeer.github.io/Claude/ccw-control/ (sin datos: pide el PIN del equipo y lee los datos en vivo).
- **API:** edge function `ccw-control` del proyecto Supabase de CCW (`supabase/functions/ccw-control/`): `/estado` devuelve el estado fusionado (base + Supabase en vivo) si la cabecera `X-CCW-PIN` lleva el PIN del equipo; `/` redirige a la página.
- **Base de datos:** `supabase/migrations/` crea la tabla `ccw_control` (filas `base` y `acceso`) y la función SQL `ccw_control_supabase()` con las exclusiones fijas.

Supabase no sirve HTML desde su dominio (lo reescribe como texto plano), por eso la página vive aquí y la función solo da datos.

Generado por el agente CCW desde `template.html`; la misma plantilla produce la versión autónoma (`CCW_Control.html`) y la publicada en Claude.
