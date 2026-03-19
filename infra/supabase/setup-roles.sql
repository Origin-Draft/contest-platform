-- Supabase Role Management for Origin Draft
--
-- Run this SQL in the Supabase SQL editor after creating your project.
-- It creates a user_roles table and a custom access token hook that injects
-- roles into app_metadata.roles so the API can read them from the JWT.
--
-- Docs: https://supabase.com/docs/guides/auth/jwts#custom-access-token-hook

-- 1. Create the role-assignment table
create table if not exists public.user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('platform-admin', 'organizer', 'judge', 'entrant')),
  created_at  timestamptz not null default now(),
  unique (user_id, role)
);

-- Row-level security: only service_role can manage roles
alter table public.user_roles enable row level security;

create policy "Service role full access"
  on public.user_roles
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Index for the hook function
create index if not exists idx_user_roles_user_id on public.user_roles(user_id);

-- 2. Create the custom access token hook
--    This function is called by Supabase Auth on every token mint/refresh.
--    It reads from user_roles and writes the list into app_metadata.roles.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb;
  roles text[];
begin
  claims := event->'claims';

  -- Collect all roles for this user
  select array_agg(r.role order by r.role)
    into roles
    from public.user_roles r
   where r.user_id = (claims->>'sub')::uuid;

  -- Default to empty array if no roles assigned
  if roles is null then
    roles := '{}';
  end if;

  -- Merge roles into app_metadata
  claims := jsonb_set(
    claims,
    '{app_metadata, roles}',
    to_jsonb(roles)
  );

  -- Return the modified event
  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- 3. Grant execute to supabase_auth_admin (required for the hook)
grant execute on function public.custom_access_token_hook to supabase_auth_admin;

-- 4. Grant usage on user_roles to the auth admin so the hook can read it
grant select on public.user_roles to supabase_auth_admin;

-- 5. Revoke public execute (defense in depth)
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

-- ============================================================================
-- After running this SQL:
--
-- 1. Go to Supabase Dashboard → Authentication → Hooks
-- 2. Enable the "Custom Access Token" hook
-- 3. Select the function: public.custom_access_token_hook
--
-- To assign roles:
--   insert into public.user_roles (user_id, role)
--   values ('<user-uuid>', 'organizer');
--
-- To bulk-assign (e.g. after inviting a judge):
--   insert into public.user_roles (user_id, role)
--   values ('<user-uuid>', 'judge')
--   on conflict (user_id, role) do nothing;
-- ============================================================================
