-- Synthetic acceptance fixtures only; all sessions have already been signed out.
-- The date, run markers and identity conditions must all match.
begin;
delete from auth.users
where raw_user_meta_data->>'floatcode_test_run' in (
  'acceptance-974ca5f1-680b-4c8a-82b2-a444c84db14e',
  'acceptance-3666844b-b722-4a36-a825-7d7d9f82df5f',
  'acceptance-d7d9e06a-3545-4843-a638-7f1e9f12e63c'
)
and created_at >= '2026-10-15T04:00:00Z'
and (is_anonymous = true or email like 'acceptance-%@example.com');
commit;

select count(*) as remaining_acceptance_users
from auth.users
where raw_user_meta_data->>'floatcode_test_run' in (
  'acceptance-974ca5f1-680b-4c8a-82b2-a444c84db14e',
  'acceptance-3666844b-b722-4a36-a825-7d7d9f82df5f',
  'acceptance-d7d9e06a-3545-4843-a638-7f1e9f12e63c'
);
