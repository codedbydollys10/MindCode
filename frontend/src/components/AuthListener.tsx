import { useEffect } from "react";
import { getSupabaseClient, hasSupabaseEnv, logSupabaseError, upsertUserProfile, getAuthProvider } from "@/lib/supabase";

// Global listener to mirror auth.users into public tables after OAuth redirects
const AuthListener = () => {
  useEffect(() => {
    if (!hasSupabaseEnv) return;
    const client = getSupabaseClient();

    const extractCodeUrl = () => {
      if (typeof window === "undefined") return null;
      const href = window.location.href;
      const hash = window.location.hash ? window.location.hash.substring(1) : "";
      const search = window.location.search ? window.location.search.substring(1) : "";
      const combined = `${search}&${hash}`;
      const params = new URLSearchParams(combined);
      if (params.get("code")) return href;
      return null;
    };

    // Handle OAuth redirect (code in URL) for PKCE flow; then clean URL.
    const codeUrl = extractCodeUrl();
    if (codeUrl) {
      client.auth
        .exchangeCodeForSession(codeUrl)
        .then(({ data, error }) => {
          if (error) {
            logSupabaseError(error, "AuthListener: exchangeCodeForSession");
            return;
          }
          const user = data.session?.user;
          if (user) {
            upsertUserProfile({
              id: user.id,
              email: user.email,
              provider: getAuthProvider(user),
              lastSignInAt: user.last_sign_in_at,
              createdAt: user.created_at,
              name: (user.user_metadata as any)?.name ?? null,
            }).catch((err) => logSupabaseError(err, "AuthListener: upsert after exchange"));
          }
        })
        .finally(() => {
          if (typeof window !== "undefined") {
            const cleanUrl = window.location.origin + window.location.pathname;
            window.history.replaceState({}, document.title, cleanUrl);
          }
        });
    }

    // On mount, try persisting existing session (handles return from Google)
    client.auth.getSession().then(({ data, error }) => {
      if (error) {
        logSupabaseError(error, "AuthListener: getSession");
        return;
      }
      const user = data.session?.user;
      if (user) {
        upsertUserProfile({
          id: user.id,
          email: user.email,
          provider: getAuthProvider(user),
          lastSignInAt: user.last_sign_in_at,
          createdAt: user.created_at,
          name: (user.user_metadata as any)?.name ?? null,
        }).catch((err) => logSupabaseError(err, "AuthListener: upsert initial"));
      }
    });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      const user = session?.user;
      if (!user) return;
      upsertUserProfile({
        id: user.id,
        email: user.email,
        provider: getAuthProvider(user),
        lastSignInAt: user.last_sign_in_at,
        createdAt: user.created_at,
        name: (user.user_metadata as any)?.name ?? null,
      }).catch((err) => logSupabaseError(err, "AuthListener: upsert on auth change"));
    });

    return () => subscription.unsubscribe();
  }, []);

  return null;
};

export default AuthListener;
