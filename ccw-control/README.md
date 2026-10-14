# CCW Control

Panel del negocio de Corporate Car Wash. Se sirve desde la edge function `ccw-control` del proyecto Supabase de CCW,
protegido con un PIN de equipo, y lee Supabase en el momento de abrirse.

- `page.html` — la página (sin datos; los pide a `./estado`). La edge function la descarga de aquí (raw) y la cachea 10 minutos.
- `supabase/functions/ccw-control/` — la función: login por PIN (cookie), `/estado` (fusión del estado base con Supabase en vivo), `/salir`.
- `supabase/migrations/` — tabla `ccw_control` (filas `base` y `acceso`) y función SQL `ccw_control_supabase()`.

Generado por el agente CCW desde la plantilla `template.html` de CCW Control; la misma plantilla produce la versión
autónoma (`CCW_Control.html`, con datos incrustados) y la publicada en Claude.
