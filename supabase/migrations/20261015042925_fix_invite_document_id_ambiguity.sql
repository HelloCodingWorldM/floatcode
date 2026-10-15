-- The RETURNS TABLE output document_id shadows the conflict target column.
-- Name the existing primary-key constraint explicitly; preserve role checks.
begin;

create or replace function public.floatcode_redeem_invite(
  p_token_hash text,
  p_user_id uuid
) returns table(document_id uuid, member_role text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  invitation public.floatcode_document_invites%rowtype;
begin
  select * into invitation
  from public.floatcode_document_invites
  where token_hash = p_token_hash
    and revoked_at is null
    and expires_at > now()
    and use_count < max_uses
  for update;

  if not found then
    return;
  end if;

  insert into public.floatcode_document_members(document_id, user_id, role)
  values (invitation.document_id, p_user_id, invitation.role)
  on conflict on constraint floatcode_document_members_pkey do nothing;

  if found then
    update public.floatcode_document_invites
    set use_count = use_count + 1
    where id = invitation.id;
  end if;

  return query select invitation.document_id, invitation.role;
end;
$$;

revoke all on function public.floatcode_redeem_invite(text, uuid) from public, anon, authenticated;
grant execute on function public.floatcode_redeem_invite(text, uuid) to service_role;

commit;
