-- Fix: dossier_ingestor uses nomination_status values that may not match an older CHECK.
-- Run in Supabase SQL Editor if you see:
--   violates check constraint "candidates_nomination_status_check"

-- 1) Drop the restrictive check (matches repo schema: no CHECK on this column).
alter table public.candidates
  drop constraint if exists candidates_nomination_status_check;

-- 2) Optional: replace with an inclusive check (comment out step 1 if you only want to widen, not drop).
-- alter table public.candidates
--   add constraint candidates_nomination_status_check
--   check (
--     nomination_status is null
--     or nomination_status in (
--       'pending', 'accepted', 'rejected', 'withdrawn', 'contesting',
--       'eci_verified', 'removed'
--     )
--   );
