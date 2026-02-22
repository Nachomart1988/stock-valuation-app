import { createClient, SupabaseClient } from '@supabase/supabase-js';

function getSupabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || '';
}

function getAnonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
}

function isValidUrl(url: string): boolean {
  try { new URL(url); return true; } catch { return false; }
}

// Lazy singleton for client-side usage
let _client: SupabaseClient | null = null;
export function getSupabaseClient(): SupabaseClient | null {
  const url = getSupabaseUrl();
  const key = getAnonKey();
  if (!url || !key || !isValidUrl(url)) return null;
  if (!_client) _client = createClient(url, key);
  return _client;
}

// Server-side admin client (bypasses RLS — only for API routes)
export function createAdminClient(): SupabaseClient | null {
  const url = getSupabaseUrl();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey || !isValidUrl(url)) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
