begin;

create extension if not exists pgcrypto;

create table if not exists public.floatcode_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled code' check (char_length(title) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.floatcode_document_members (
  document_id uuid not null references public.floatcode_documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor')),
  joined_at timestamptz not null default now(),
  primary key (document_id, user_id)
);

create table if not exists public.floatcode_document_invites (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.floatcode_documents(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  role text not null default 'editor' check (role = 'editor'),
  expires_at timestamptz not null,
  max_uses integer not null default 25 check (max_uses between 1 and 100),
  use_count integer not null default 0 check (use_count >= 0),
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists floatcode_members_user_idx
  on public.floatcode_document_members(user_id, document_id);
create index if not exists floatcode_invites_document_idx
  on public.floatcode_document_invites(document_id, created_at desc);
create index if not exists floatcode_documents_owner_idx
  on public.floatcode_documents(owner_id);
create index if not exists floatcode_invites_created_by_idx
  on public.floatcode_document_invites(created_by);

alter table public.floatcode_documents enable row level security;
alter table public.floatcode_document_members enable row level security;
alter table public.floatcode_document_invites enable row level security;

drop policy if exists "members read documents" on public.floatcode_documents;
create policy "members read documents"
  on public.floatcode_documents for select to authenticated
  using (
    exists (
      select 1 from public.floatcode_document_members member
      where member.document_id = floatcode_documents.id
        and member.user_id = (select auth.uid())
    )
  );

drop policy if exists "users read own membership" on public.floatcode_document_members;
create policy "users read own membership"
  on public.floatcode_document_members for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "owners read invitations" on public.floatcode_document_invites;
create policy "owners read invitations"
  on public.floatcode_document_invites for select to authenticated
  using (
    exists (
      select 1 from public.floatcode_document_members member
      where member.document_id = floatcode_document_invites.document_id
        and member.user_id = (select auth.uid())
        and member.role = 'owner'
    )
  );

create or replace function public.floatcode_create_document(
  p_owner_id uuid,
  p_title text
) returns table(document_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_id uuid;
begin
  insert into public.floatcode_documents(owner_id, title)
  values (p_owner_id, left(coalesce(nullif(trim(p_title), ''), 'Untitled code'), 80))
  returning id into created_id;

  insert into public.floatcode_document_members(document_id, user_id, role)
  values (created_id, p_owner_id, 'owner');

  return query select created_id;
end;
$$;

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
  on conflict (document_id, user_id) do nothing;

  if found then
    update public.floatcode_document_invites
    set use_count = use_count + 1
    where id = invitation.id;
  end if;

  return query select invitation.document_id, invitation.role;
end;
$$;

revoke all on function public.floatcode_create_document(uuid, text) from public, anon, authenticated;
revoke all on function public.floatcode_redeem_invite(text, uuid) from public, anon, authenticated;
grant execute on function public.floatcode_create_document(uuid, text) to service_role;
grant execute on function public.floatcode_redeem_invite(text, uuid) to service_role;

revoke all on public.floatcode_documents from anon;
revoke all on public.floatcode_document_members from anon;
revoke all on public.floatcode_document_invites from anon, authenticated;
revoke all on public.floatcode_documents from authenticated;
revoke all on public.floatcode_document_members from authenticated;
grant select on public.floatcode_documents to authenticated;
grant select on public.floatcode_document_members to authenticated;
grant all on public.floatcode_documents to service_role;
grant all on public.floatcode_document_members to service_role;
grant all on public.floatcode_document_invites to service_role;

commit;
