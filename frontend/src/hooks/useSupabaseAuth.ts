import { useEffect, useState, useCallback } from "react";
import type { Provider, Session, User } from "@supabase/supabase-js";
import { getSupabaseClient, hasSupabaseEnv, logSupabaseError, upsertUserProfile } from "@/lib/supabase";

type AuthError = string | null;

export const useSupabaseAuth = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AuthError>(null);

  const ensureEnv = useCallback(() => {
    if (!hasSupabaseEnv) {
      const envError = new Error("Supabase environment variables are missing.");
      logSupabaseError(envError, "env check");
      setError(envError.message);
      throw envError;
    }
  }, []);

  const persistProfile = useCallback(async (user: User | null) => {
    if (!user) return;
    await upsertUserProfile({
      id: user.id,
      email: user.email,
      provider: user.app_metadata?.provider || user.identities?.[0]?.provider || null,
      lastSignInAt: user.last_sign_in_at,
      createdAt: user.created_at,
      name: (user.user_metadata as any)?.name ?? null,
    });
  }, []);

  useEffect(() => {
    if (!hasSupabaseEnv) {
      setLoading(false);
      return;
    }

    const client = getSupabaseClient();
    client.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) {
        logSupabaseError(sessionError, "auth.getSession (initial)");
        setError(sessionError.message);
        setLoading(false);
        return;
      }
      setSession(data.session);
      if (data.session?.user) {
        persistProfile(data.session.user).catch((err) => {
          logSupabaseError(err, "persistProfile on initial session");
        });
      }
      setLoading(false);
    }).catch((err) => {
      logSupabaseError(err, "auth.getSession (initial catch)");
      setLoading(false);
    });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
      if (nextSession?.user) persistProfile(nextSession.user).catch((err) => {
        logSupabaseError(err, "persistProfile on auth change");
      });
    });

    return () => subscription.unsubscribe();
  }, [persistProfile, hasSupabaseEnv]);

  const signInWithPassword = async (email: string, password: string) => {
    ensureEnv();
    const client = getSupabaseClient();
    const normalizedEmail = email.trim().toLowerCase();
    setLoading(true);
    setError(null);
    const { data, error: authError } = await client.auth.signInWithPassword({ email: normalizedEmail, password });
    setLoading(false);
    if (authError) {
      logSupabaseError(authError, "auth.signInWithPassword");
      setError(authError.message);
      throw authError;
    }

    try {
      await persistProfile(data.user);
    } catch (err) {
      // Do not block successful authentication on profile mirror issues.
      logSupabaseError(err, "persistProfile after signIn");
    }
    return data;
  };

  const signUpWithPassword = async (email: string, password: string, name?: string) => {
    ensureEnv();
    const client = getSupabaseClient();
    const normalizedEmail = email.trim().toLowerCase();
    setLoading(true);
    setError(null);
    const { data, error: authError } = await client.auth.signUp({
      email: normalizedEmail,
      password,
      options: { data: { ...(name ? { name } : {}) } },
    });
    setLoading(false);
    if (authError) {
      logSupabaseError(authError, "auth.signUp");
      setError(authError.message);
      throw authError;
    }
    try {
      await persistProfile(data.user);
    } catch (err) {
      logSupabaseError(err, "persistProfile after signUp");
    }
    return data;
  };

  const resendSignupConfirmation = async (email: string) => {
    ensureEnv();
    const client = getSupabaseClient();
    const normalizedEmail = email.trim().toLowerCase();
    setLoading(true);
    setError(null);
    const { error: resendError } = await client.auth.resend({
      type: "signup",
      email: normalizedEmail,
      options: {
        emailRedirectTo: import.meta.env.VITE_SUPABASE_REDIRECT_TO as string | undefined,
      },
    });
    setLoading(false);
    if (resendError) {
      logSupabaseError(resendError, "auth.resend signup confirmation");
      setError(resendError.message);
      throw resendError;
    }
  };

  const signInWithProvider = async (provider: Provider) => {
    ensureEnv();
    const client = getSupabaseClient();
    setLoading(true);
    setError(null);
    const redirectTo = (() => {
      const envRedirect = import.meta.env.VITE_SUPABASE_REDIRECT_TO as string | undefined;
      if (envRedirect) return envRedirect;
      if (typeof window !== "undefined") return `${window.location.origin}/dashboard`;
      return undefined;
    })();

    const { error: authError, data } = await client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        skipBrowserRedirect: false,
      },
    });
    setLoading(false);
    if (authError) {
      logSupabaseError(authError, "auth.signInWithOAuth");
      setError(authError.message);
      throw authError;
    }
    // Explicit redirect to provider URL for SPA reliability
    if (data?.url) {
      window.location.assign(data.url);
    }
    return data;
  };

  const signOut = async () => {
    ensureEnv();
    const client = getSupabaseClient();
    setLoading(true);
    setError(null);
    const { error: signOutError } = await client.auth.signOut();
    setLoading(false);
    if (signOutError) {
      logSupabaseError(signOutError, "auth.signOut");
      setError(signOutError.message);
    }
  };

  return {
    session,
    user: session?.user ?? null,
    userRole: "student" as const,
    loading,
    error,
    signInWithPassword,
    signUpWithPassword,
    signInWithProvider,
    resendSignupConfirmation,
    signOut,
  };
};

export default useSupabaseAuth;
