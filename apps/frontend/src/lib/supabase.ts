import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// For local development without Supabase, auth features will be disabled
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Create a mock client for local dev without Supabase
// All auth methods return errors — routes stay protected, nothing crashes
const createMockClient = () => ({
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signInWithPassword: async () => ({ data: { user: null, session: null }, error: new Error('Supabase not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.') }),
    signInWithOAuth: async () => ({ data: { provider: '', url: '' }, error: new Error('Supabase not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.') }),
    signUp: async () => ({ data: { user: null, session: null }, error: new Error('Supabase not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.') }),
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
