import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

type SupabaseLikeError = {
  message?: string;
  status?: number;
  code?: string;
  name?: string;
  details?: string;
  hint?: string;
  stack?: string;
};

// Uniform console logging for Supabase failures so we can trace "why details aren't storing".
export const logSupabaseError = (err: unknown, context: string) => {
  if (!err) return;
  const e = err as SupabaseLikeError;
  console.error("[Supabase]", context, {
    name: e.name,
    code: e.code,
    status: e.status,
    message: e.message,
    details: e.details,
    hint: e.hint,
    stack: e.stack,
  });
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const hasSupabaseEnv = Boolean(supabaseUrl && supabaseAnonKey);

if (!hasSupabaseEnv) {
  // Fail fast in dev to surface misconfigured env
  console.warn("Supabase env vars missing. Check .env setup.");
}

let supabase: SupabaseClient | null = null;

if (hasSupabaseEnv) {
  supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      debug: true,
    },
  });
}

export const getSupabaseClient = (): SupabaseClient => {
  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }
  return supabase;
};

// No-op placeholder: we rely solely on Supabase's built-in auth.users table.
export const upsertUserProfile = async (params: {
  id: string;
  email: string | null;
  provider: string | null;
  lastSignInAt: string | null;
  createdAt?: string | null;
  name?: string | null;
}) => {
  const client = getSupabaseClient();
  const payload = {
    id: params.id, // align with auth.users id so FK works
    email: params.email,
    name: params.name ?? null,
    created_at: params.createdAt ?? undefined,
  };

  const { error } = await client.from("users").upsert(payload, { onConflict: "id" });
  if (error) {
    logSupabaseError(error, "users upsert");
    throw error;
  }
};

// Safely extract provider for email/password + OAuth (Google/GitHub)
export const getAuthProvider = (user: User | null): string | null => {
  if (!user) return null;
  return (
    user.app_metadata?.provider ||
    user.identities?.[0]?.provider ||
    null
  );
};
