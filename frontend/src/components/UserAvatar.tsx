import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type UserAvatarProps = {
  userId?: string;
  name: string;
  srcOverride?: string | null;
  className?: string;
  imageClassName?: string;
};

const UserAvatar = ({ userId, name, srcOverride, className, imageClassName }: UserAvatarProps) => {
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const isOverridden = srcOverride !== undefined;

  useEffect(() => {
    if (!userId || isOverridden) return;
    let active = true;
    setLoadedSource(null);
    setProfileName(null);
    const loadAvatar = async () => {
      try {
        const client = getSupabaseClient();
        let { data, error } = await client.from("users")
          .select("name,avatar_path,photo_data")
          .eq("id", userId)
          .maybeSingle();
        if (error && (error.code === "42703" || error.code === "PGRST204" || /avatar_path.*(?:does not exist|could not find)/i.test(error.message))) {
          const legacyProfile = await client.from("users")
            .select("name,photo_data")
            .eq("id", userId)
            .maybeSingle();
          if (legacyProfile.error) throw legacyProfile.error;
          data = { ...legacyProfile.data, avatar_path: null };
          error = null;
        }
        if (error) throw error;
        if (!active || !data) {
          if (active) setLoadedSource(null);
          return;
        }
        if (active) setProfileName(data.name || null);
        if (data.avatar_path) {
          const { data: signed, error: signedError } = await client.storage
            .from("avatars")
            .createSignedUrl(data.avatar_path, 3600);
          if (signedError) {
            console.warn("[UserAvatar] Unable to sign profile image:", signedError);
            if (active) setLoadedSource(data.photo_data || null);
          } else if (active) {
            setLoadedSource(signed.signedUrl);
          }
        } else if (active) {
          setLoadedSource(data.photo_data || null);
        }
      } catch (error) {
        console.warn("[UserAvatar] Unable to load profile image:", error);
        if (active) setLoadedSource(null);
      }
    };
    void loadAvatar();
    return () => { active = false; };
  }, [userId, isOverridden]);

  const source = isOverridden ? srcOverride : loadedSource;
  const initials = (profileName || name).trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  useEffect(() => setImageFailed(false), [source]);

  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-bg-hover font-semibold text-teal", className)}>
      {source && !imageFailed
        ? <img src={source} alt="" className={cn("h-full w-full object-cover", imageClassName)} onError={() => setImageFailed(true)} />
        : <span aria-hidden="true">{initials || "?"}</span>}
    </span>
  );
};

export default UserAvatar;
