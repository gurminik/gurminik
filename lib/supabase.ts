import { createClient } from "@supabase/supabase-js";

const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://qzvcsfiujrbsqrvtqmob.supabase.co";
const supabasePublishableKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"sb_publishable_7o9_EX47Tk08jUqcdm0uxw__m4rVR7a";

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
