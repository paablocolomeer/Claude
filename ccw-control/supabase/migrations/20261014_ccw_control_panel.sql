-- CCW Control · panel del negocio servido por la edge function ccw-control
create table if not exists public.ccw_control (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
comment on table public.ccw_control is 'CCW Control: fila base = estado del panel (finanzas, objetivos, edificios); fila acceso = PIN del equipo. Solo la lee la edge function (service role).';
alter table public.ccw_control enable row level security;
revoke all on table public.ccw_control from anon, authenticated;

create or replace function public.ccw_control_supabase()
returns json
language sql
security definer
set search_path = public
as $fn$
-- CCW Control · extracción diaria desde Supabase (una sola fila, columna estado_supabase en JSON)
-- Exclusiones: edificio TeamLabs, cuentas del equipo/Innovit, reservas huérfanas (sin usuario o sin edificio) y reservas "pending" (sin pago).
with excl as (
  select u.id from users u
  where lower(u.email) like '%.danu@gmail.com' or lower(u.email) like '%bugfree%' or lower(u.email) like '%snehankit%'
     or lower(u.email) like 'rajanv%' or lower(u.email) like 'jose.rivera.dev%'
     or lower(u.email) in ('pablocolomer.danu@gmail.com','pablogon.danu@gmail.com','alvarom.danu@gmail.com','davidsanchezmadridano.danu@gmail.com')
),
edif as (
  select b.id, b.name, b.parking_spots, b.is_active, b.created_at::date as alta, b.recogida_llaves::text as recogida, b.address
  from buildings b where lower(b.name) not like '%teamlabs%'
),
bk as (
  select md5(lower(u.email)) as cli, e.name as edificio, bk.scheduled_date::text as fecha, bk.status::text as status,
         bk.final_price, bk.original_price, w.full_name as worker,
         coalesce((select sum(p.amount) from payments p where p.booking_id = bk.id and p.status::text = 'succeeded'), 0) as pagado,
         coalesce((select sum(p.refund_amount) from payments p where p.booking_id = bk.id), 0) as devuelto,
         bk.created_at
  from bookings bk
  join users u on u.id = bk.user_id
  join edif e on e.id = bk.building_id
  left join workers w on w.id = bk.worker_id
  where bk.user_id not in (select id from excl) and bk.status::text <> 'pending'
),
reg as (
  select to_char(ub.created_at, 'YYYY-MM') as mes, e.name as edificio, count(*) as n
  from user_buildings ub join edif e on e.id = ub.building_id join users u on u.id = ub.user_id
  where ub.user_id not in (select id from excl)
  group by 1, 2
),
wk as (
  select w.full_name, w.is_active, w.n_wash, w.survey_avg, w.capacity_minutes_per_day, w.contract_type, w.fixed_monthly_cost,
         w.working_window_start, w.working_window_end,
         (select count(*) from satisfaction_surveys s where s.worker_id = w.id) as n_valoraciones,
         (select avg(s.general_satisfaction) from satisfaction_surveys s where s.worker_id = w.id) as estrellas
  from workers w
)
select json_build_object(
  'generado', to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM-DD HH24:MI'),
  'hoy', to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM-DD'),
  'reservas', (select coalesce(json_agg(json_build_array(cli, edificio, fecha, status, final_price, worker, pagado, devuelto) order by created_at, fecha), '[]'::json) from bk),
  'registros', (select coalesce(json_agg(json_build_array(mes, edificio, n) order by mes, edificio), '[]'::json) from reg),
  'edificios', (select coalesce(json_agg(json_build_object('name', name, 'plazas', parking_spots, 'activo', is_active, 'alta', alta, 'recogida', recogida, 'direccion', address) order by alta), '[]'::json) from edif),
  'trabajadores', (select coalesce(json_agg(row_to_json(wk)), '[]'::json) from wk)
);
$fn$;
revoke execute on function public.ccw_control_supabase() from public, anon, authenticated;
grant execute on function public.ccw_control_supabase() to service_role;
