import { createClient } from '@supabase/supabase-js'

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  if (typeof window === "undefined") {
    // Only warn server-side; browser bundles always see NEXT_PUBLIC_ values baked in at build time.
    console.warn(
      "[supabase] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. " +
      "The app will not connect to the database."
    );
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * Browser Supabase client — anon key, SELECT only via RLS.
 * Realtime (postgres_changes) needs tables under Database → Publications in Supabase.
 * If the channel errors the app falls back to REST polling; data still updates.
 */
export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: { params: { eventsPerSecond: 10 } },
})
