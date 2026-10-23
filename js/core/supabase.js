// Supabase client. The library is vendored (/vendor/supabase.js, loaded by index.html as a classic script).
import { supabaseConfig } from '../config.js';

export function createSupabase() {
  if (!globalThis.supabase?.createClient) throw new Error('Supabase library failed to load');
  return globalThis.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  });
}
