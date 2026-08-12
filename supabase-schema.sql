-- Jusa Boutique: esquema multiusuario para Supabase.
-- Ejecutar completo una vez en Supabase: SQL Editor > New query > Run.
-- No ejecutar esta migración sobre una instalación con tablas del mismo nombre.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 100),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create type public.member_role as enum ('admin', 'vendedora');

create table public.memberships (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.member_role not null default 'vendedora',
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  email text not null,
  role public.member_role not null default 'vendedora',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (business_id, email)
);

create table public.business_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  cotizacion numeric(14, 2) not null default 1420 check (cotizacion >= 0),
  pasajes numeric(14, 2) not null default 250000 check (pasajes >= 0),
  viaticos numeric(14, 2) not null default 150000 check (viaticos >= 0),
  flete numeric(14, 2) not null default 50000 check (flete >= 0),
  profit_mode text not null default 'markup' check (profit_mode in ('markup', 'margin')),
  allocation_method text not null default 'value' check (allocation_method in ('value', 'quantity')),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

create table public.garments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  quantity numeric(12, 2) not null default 1 check (quantity > 0),
  price_brl numeric(14, 2) not null default 0 check (price_brl >= 0),
  profit_percentage numeric(7, 2) not null default 100 check (profit_percentage >= 0 and profit_percentage < 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

create index garments_business_id_idx on public.garments (business_id);
create index invitations_business_email_idx on public.invitations (business_id, lower(email));

-- Acepta las invitaciones dirigidas a un correo ya verificado. Solo se ejecuta
-- desde los triggers de auth.users: nadie puede llamarla desde la aplicación.
create or replace function public.accept_invitations(target_user_id uuid, target_email text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if coalesce(trim(target_email), '') = '' then
    return;
  end if;
  with accepted as (
    delete from public.invitations
    where lower(email) = lower(trim(target_email))
    returning business_id, role
  )
  insert into public.memberships (business_id, user_id, role)
  select business_id, target_user_id, role from accepted
  on conflict (business_id, user_id) do nothing;
end;
$$;

-- Se crea un perfil al registrarse. La invitación se acepta solo cuando el
-- correo quedó verificado: así nadie obtiene acceso registrando el correo de
-- otra persona. La validación se ejecuta en la base, no en el navegador.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do update set email = excluded.email;

  if new.email_confirmed_at is not null then
    perform public.accept_invitations(new.id, new.email);
  end if;
  return new;
end;
$$;

create or replace function public.handle_user_confirmed()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    perform public.accept_invitations(new.id, new.email);
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute procedure public.handle_user_confirmed();

create or replace function public.is_business_member(target_business_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships
    where business_id = target_business_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_business_admin(target_business_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships
    where business_id = target_business_id
      and user_id = auth.uid()
      and role = 'admin'
  );
$$;

-- Permite a la primera persona crear la boutique compartida desde la aplicación.
create or replace function public.create_business(business_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare created_id uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticada';
  end if;
  insert into public.businesses (name, created_by)
  values (trim(business_name), auth.uid())
  returning id into created_id;
  insert into public.memberships (business_id, user_id, role)
  values (created_id, auth.uid(), 'admin');
  insert into public.business_settings (business_id, updated_by)
  values (created_id, auth.uid());
  return created_id;
end;
$$;

-- Una administradora invita con un solo flujo. Si la persona ya creó una
-- cuenta (por ejemplo, recibió una invitación desde el Dashboard), se une de
-- inmediato; si no, queda pendiente hasta que se registre con ese correo.
create or replace function public.invite_member(
  target_business_id uuid,
  target_email text,
  target_role public.member_role default 'vendedora'
)
returns text
language plpgsql security definer set search_path = public
as $$
declare target_user_id uuid;
begin
  if not public.is_business_admin(target_business_id) then
    raise exception 'Solo una administradora puede invitar al equipo';
  end if;
  if coalesce(trim(target_email), '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Ingresá un correo válido';
  end if;
  select id into target_user_id from public.profiles where lower(email) = lower(trim(target_email));
  if target_user_id is not null then
    insert into public.memberships (business_id, user_id, role)
    values (target_business_id, target_user_id, target_role)
    on conflict (business_id, user_id) do update set role = excluded.role;
    delete from public.invitations where business_id = target_business_id and lower(email) = lower(trim(target_email));
    return 'joined';
  end if;
  insert into public.invitations (business_id, email, role, created_by)
  values (target_business_id, lower(trim(target_email)), target_role, auth.uid())
  on conflict (business_id, email) do update set role = excluded.role, created_by = auth.uid(), created_at = now();
  return 'pending';
end;
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

create trigger set_settings_updated_at before update on public.business_settings
  for each row execute procedure public.set_updated_at();
create trigger set_garments_updated_at before update on public.garments
  for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.business_settings enable row level security;
alter table public.garments enable row level security;

create policy "profile propio" on public.profiles for select to authenticated using (id = auth.uid());
create policy "negocios de miembros" on public.businesses for select to authenticated using (public.is_business_member(id));
create policy "miembros ven su equipo" on public.memberships for select to authenticated using (public.is_business_member(business_id));
create policy "admins ven invitaciones" on public.invitations for select to authenticated using (public.is_business_admin(business_id));
create policy "admins crean invitaciones" on public.invitations for insert to authenticated with check (public.is_business_admin(business_id) and created_by = auth.uid());
create policy "admins eliminan invitaciones" on public.invitations for delete to authenticated using (public.is_business_admin(business_id));
create policy "equipo ve configuracion" on public.business_settings for select to authenticated using (public.is_business_member(business_id));
create policy "equipo actualiza configuracion" on public.business_settings for update to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "equipo ve prendas" on public.garments for select to authenticated using (public.is_business_member(business_id));
create policy "equipo agrega prendas" on public.garments for insert to authenticated with check (public.is_business_member(business_id) and updated_by = auth.uid());
create policy "equipo actualiza prendas" on public.garments for update to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "equipo borra prendas" on public.garments for delete to authenticated using (public.is_business_member(business_id));

grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.businesses, public.memberships, public.invitations, public.business_settings, public.garments to authenticated;
grant insert on public.invitations, public.garments to authenticated;
grant delete on public.invitations, public.garments to authenticated;

-- Solo las columnas editables desde la aplicación: business_id, id y las de
-- auditoría no se pueden modificar, así una integrante no puede mover filas
-- hacia otra boutique ni falsear updated_by.
grant update (cotizacion, pasajes, viaticos, flete, profit_mode, allocation_method)
  on public.business_settings to authenticated;
grant update (name, quantity, price_brl, profit_percentage)
  on public.garments to authenticated;

-- Postgres otorga execute a public por defecto: hay que revocarlo antes de
-- habilitar solo a las cuentas autenticadas.
revoke execute on function public.create_business(text) from public, anon;
revoke execute on function public.invite_member(uuid, text, public.member_role) from public, anon;
revoke execute on function public.accept_invitations(uuid, text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_confirmed() from public, anon, authenticated;
revoke execute on function public.is_business_member(uuid) from public, anon;
revoke execute on function public.is_business_admin(uuid) from public, anon;
grant execute on function public.create_business(text) to authenticated;
grant execute on function public.invite_member(uuid, text, public.member_role) to authenticated;
grant execute on function public.is_business_member(uuid) to authenticated;
grant execute on function public.is_business_admin(uuid) to authenticated;
