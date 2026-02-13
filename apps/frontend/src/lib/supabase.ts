import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// For local development without Supabase, auth features will be disabled
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Create a mock client for local dev without Supabase
const createMockClient = () => ({
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signInWithOAuth: async () => ({ data: null, error: new Error('Supabase not configured') }),
    signOut: async () => ({ error: null }),
  },
}) as unknown as SupabaseClient;

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : createMockClient();

if (!isSupabaseConfigured) {
  console.warn('⚠️ Supabase not configured - auth features disabled. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for auth.');
}
