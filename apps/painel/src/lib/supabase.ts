import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        flowType: "pkce",
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true
      }
    })
  : null;

export async function completeAuthSessionFromUrl() {
  if (!supabase || typeof window === "undefined") {
    return { data: null, error: null };
  }

  const currentUrl = new URL(window.location.href);
  const authCode = currentUrl.searchParams.get("code");
  if (!authCode) return { data: null, error: null };

  const result = await supabase.auth.exchangeCodeForSession(authCode);
  if (!result.error) {
    currentUrl.searchParams.delete("code");
    currentUrl.searchParams.delete("state");
    currentUrl.searchParams.delete("scope");
    currentUrl.searchParams.delete("authuser");
    currentUrl.searchParams.delete("prompt");
    currentUrl.searchParams.delete("type");
    window.history.replaceState({}, document.title, `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
  }

  return result;
}
