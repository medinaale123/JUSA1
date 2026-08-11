-- Ejecutá este archivo UNA VEZ si ya ejecutaste supabase-schema.sql antes.
-- Supabase > SQL Editor > New query > pegar > Run.

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
  if trim(target_email) = '' then
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

grant execute on function public.invite_member(uuid, text, public.member_role) to authenticated;
