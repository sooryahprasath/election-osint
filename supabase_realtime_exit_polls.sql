-- Run once if exit_polls changes are not streaming to the client.
alter publication supabase_realtime add table public.exit_polls;
