-- Actualización de seguridad para instalaciones que ya ejecutaron
-- supabase-schema.sql. Supabase > SQL Editor > New query > pegar > Run.
-- Se puede ejecutar más de una vez sin efectos secundarios.

-- 1. La invitación se acepta solo con el correo verificado. Antes, cualquiera
-- que conociera un correo invitado obtenía acceso al registrarse con él.
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

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute procedure public.handle_user_confirmed();

-- 2. Validación de correo al invitar.
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

-- 3. search_path fijo en el trigger de auditoría.
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

-- 4. Solo las columnas editables desde la aplicación: nadie puede mover una
-- prenda o la configuración hacia otra boutique ni falsear updated_by.
revoke update on public.business_settings from authenticated;
revoke update on public.garments from authenticated;
grant update (cotizacion, pasajes, viaticos, flete, profit_mode, allocation_method)
  on public.business_settings to authenticated;
grant update (name, quantity, price_brl, profit_percentage)
  on public.garments to authenticated;

-- 5. Postgres otorga execute a public por defecto; hay que revocarlo.
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
