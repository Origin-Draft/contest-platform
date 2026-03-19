-- Supabase Storage Bucket Setup for Origin Draft
--
-- Run this SQL in the Supabase SQL editor after creating your project.
-- It creates the 'artifacts' bucket used by the contest platform for
-- submission artifact uploads (scene cards, prompt logs, etc.).

-- 1. Create the artifacts bucket (private, not public)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'artifacts',
  'artifacts',
  false,
  52428800,  -- 50 MB max per file
  null       -- allow all MIME types
)
on conflict (id) do nothing;

-- 2. RLS policies for the artifacts bucket
--    Only the service_role key is used server-side, so we don't need
--    user-facing policies. The API acts as a gateway with its own
--    authorization layer (Cedar policies + role checks).

-- Allow service_role to upload
create policy "Service role can upload artifacts"
  on storage.objects
  for insert
  with check (
    bucket_id = 'artifacts'
    and auth.role() = 'service_role'
  );

-- Allow service_role to read
create policy "Service role can read artifacts"
  on storage.objects
  for select
  using (
    bucket_id = 'artifacts'
    and auth.role() = 'service_role'
  );

-- Allow service_role to delete
create policy "Service role can delete artifacts"
  on storage.objects
  for delete
  using (
    bucket_id = 'artifacts'
    and auth.role() = 'service_role'
  );
