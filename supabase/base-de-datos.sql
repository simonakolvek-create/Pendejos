-- ============================================================
--  PENDEJOS — Base de datos completa
--  (Ya está instalada en tu proyecto; este archivo queda como respaldo)
-- ============================================================

-- ---------- 1. Partidos, amigos, fotos y notificaciones ----------

-- Amigos del grupo (jugadores y cumpleaños)
create table if not exists public.amigos (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  cumple_dia  int check (cumple_dia between 1 and 31),
  cumple_mes  int check (cumple_mes between 1 and 12),
  usuario     uuid unique,
  es_admin    boolean not null default false,
  creado_en   timestamptz default now()
);

-- Partidos (fecha, parejas y quién ganó)
create table if not exists public.partidos (
  id         uuid primary key default gen_random_uuid(),
  fecha      date not null,
  hora       time,
  lugar      text,
  equipo_a   uuid[] not null default '{}',
  equipo_b   uuid[] not null default '{}',
  marcador   text,
  ganador    text check (ganador in ('A', 'B')),
  notas      text,
  creado_en  timestamptz default now()
);

-- Fotos / recuerdos
create table if not exists public.recuerdos (
  id           uuid primary key default gen_random_uuid(),
  ruta         text not null,
  descripcion  text,
  fecha        date default current_date,
  partido_id   uuid references public.partidos(id) on delete set null,
  subido_por   uuid default auth.uid(),
  creado_en    timestamptz default now()
);

-- Celulares que activaron las notificaciones
create table if not exists public.suscripciones_push (
  endpoint   text primary key,
  p256dh     text not null,
  auth       text not null,
  usuario    uuid default auth.uid(),
  creado_en  timestamptz default now()
);

-- Seguridad: solo la gente con sesión iniciada (el grupo) puede ver y editar
alter table public.amigos             enable row level security;
alter table public.partidos           enable row level security;
alter table public.recuerdos          enable row level security;
alter table public.suscripciones_push enable row level security;

create policy "grupo" on public.amigos             for all to authenticated using (true) with check (true);
create policy "grupo" on public.partidos           for all to authenticated using (true) with check (true);
create policy "grupo" on public.recuerdos          for all to authenticated using (true) with check (true);
create policy "grupo" on public.suscripciones_push for all to authenticated using (true) with check (true);

-- Carpeta privada para las fotos
insert into storage.buckets (id, name, public)
values ('recuerdos', 'recuerdos', false)
on conflict (id) do nothing;

create policy "grupo ve fotos"    on storage.objects for select to authenticated using (bucket_id = 'recuerdos');
create policy "grupo sube fotos"  on storage.objects for insert to authenticated with check (bucket_id = 'recuerdos');
create policy "grupo borra fotos" on storage.objects for delete to authenticated using (bucket_id = 'recuerdos');

-- El grupo (los cumpleaños se agregan desde la app, en 🎂 Amigos)
insert into public.amigos (nombre, es_admin)
select n, n = 'Simona' from unnest(array['Simona', 'Ricardo', 'Chocolo', 'Jaime', 'Manu', 'Patri', 'Fernando']) as n
where not exists (select 1 from public.amigos);


-- ---------- 2. Inicio editable ----------

-- Quién puede editar el Inicio: los amigos marcados como admin
create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.amigos where usuario = auth.uid() and es_admin);
$$;

-- Portada (una sola fila)
create table if not exists public.inicio (
  id              int primary key default 1 check (id = 1),
  titulo          text,
  mensaje         text,
  portada_ruta    text,
  actualizado_en  timestamptz default now()
);
insert into public.inicio (id, titulo, mensaje)
values (1, '¡Bienvenidos, Pendejos!', 'Aquí van los avisos del grupo. 🎾')
on conflict (id) do nothing;

-- Tablón de publicaciones
create table if not exists public.publicaciones (
  id           uuid primary key default gen_random_uuid(),
  texto        text,
  imagen_ruta  text,
  fijada       boolean not null default false,
  creado_en    timestamptz default now()
);

alter table public.inicio        enable row level security;
alter table public.publicaciones enable row level security;

create policy "todos leen" on public.inicio        for select to authenticated using (true);
create policy "admin edita" on public.inicio       for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy "todos leen" on public.publicaciones for select to authenticated using (true);
create policy "admin publica" on public.publicaciones for insert to authenticated with check (public.es_admin());
create policy "admin cambia"  on public.publicaciones for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy "admin borra"   on public.publicaciones for delete to authenticated using (public.es_admin());


-- ---------- 3. ¿Quién va?, MVP, torneos, comentarios y reacciones ----------

-- Cada cuenta se vincula con su nombre en la lista de amigos

-- Control de avisos automáticos de cada partido
alter table public.partidos add column if not exists aviso_nuevo    boolean not null default false;
alter table public.partidos add column if not exists aviso_completo boolean not null default false;
update public.partidos set aviso_nuevo = true where aviso_nuevo = false;  -- no avisar de los que ya existían

-- ¿Quién va?
create table if not exists public.asistencias (
  partido_id  uuid not null references public.partidos(id) on delete cascade,
  amigo_id    uuid not null references public.amigos(id) on delete cascade,
  estado      text not null check (estado in ('voy', 'no')),
  creado_en   timestamptz default now(),
  primary key (partido_id, amigo_id)
);

-- Mejor jugador del día (un voto por persona y día)
create table if not exists public.votos_dia (
  fecha       date not null,
  votante     uuid not null references public.amigos(id) on delete cascade,
  votado      uuid not null references public.amigos(id) on delete cascade,
  creado_en   timestamptz default now(),
  primary key (fecha, votante)
);

-- Torneos relámpago
create table if not exists public.torneos (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  fecha      date not null default current_date,
  datos      jsonb not null,
  creado_en  timestamptz default now()
);

-- Comentarios y reacciones (en fotos y publicaciones del tablón)
create table if not exists public.comentarios (
  id         uuid primary key default gen_random_uuid(),
  tipo       text not null check (tipo in ('foto', 'pub')),
  objeto_id  uuid not null,
  autor      uuid references public.amigos(id) on delete set null,
  texto      text not null,
  creado_en  timestamptz default now()
);

create table if not exists public.reacciones (
  tipo       text not null check (tipo in ('foto', 'pub')),
  objeto_id  uuid not null,
  amigo_id   uuid not null references public.amigos(id) on delete cascade,
  emoji      text not null,
  creado_en  timestamptz default now(),
  primary key (tipo, objeto_id, amigo_id, emoji)
);

alter table public.asistencias enable row level security;
alter table public.votos_dia   enable row level security;
alter table public.torneos     enable row level security;
alter table public.comentarios enable row level security;
alter table public.reacciones  enable row level security;

create policy "grupo" on public.asistencias for all to authenticated using (true) with check (true);
create policy "grupo" on public.votos_dia   for all to authenticated using (true) with check (true);
create policy "grupo" on public.torneos     for all to authenticated using (true) with check (true);
create policy "grupo" on public.comentarios for all to authenticated using (true) with check (true);
create policy "grupo" on public.reacciones  for all to authenticated using (true) with check (true);


-- ---------- 4. Configuración privada (solo la leen las funciones del servidor) ----------
create table if not exists public.config_privada (clave text primary key, valor text not null);
alter table public.config_privada enable row level security;  -- sin políticas: nadie desde la app puede leerla

-- Los amigos no pueden marcarse como admin ni robar la cuenta de otro
create or replace function public.proteger_amigos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'authenticated' and not public.es_admin() then
    new.es_admin := coalesce(old.es_admin, false);
    new.usuario := old.usuario;
  end if;
  if tg_op = 'INSERT' and auth.role() = 'authenticated' then
    new.usuario := null;
    if not public.es_admin() then new.es_admin := false; end if;
  end if;
  return new;
end $$;
drop trigger if exists proteger_amigos on public.amigos;
create trigger proteger_amigos before insert or update on public.amigos
  for each row execute function public.proteger_amigos();

-- ---------- 5. Solo miembros del grupo (cuentas vinculadas a un amigo) ----------
create or replace function public.es_miembro() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.amigos where usuario = auth.uid());
$$;
-- (todas las políticas "grupo" usan public.es_miembro() en lugar de true; ver migración solo_miembros)

-- ---------- 6. Avisos automáticos (pg_cron + pg_net) ----------
-- select cron.schedule('avisos-diario', '0 8 * * *', $$select public.lanzar_avisos('diario')$$);
-- select cron.schedule('avisos-cada30', '*/30 * * * *', $$select public.lanzar_avisos('cada30')$$);
