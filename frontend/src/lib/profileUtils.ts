export const dateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const getStreakStats = (activityDays: string[], today = new Date()) => {
  const dates = [...new Set(activityDays)].sort((a, b) => b.localeCompare(a));
  if (dates.length === 0) return { current: 0, longest: 0, totalDays: 0 };

  const todayKey = dateKey(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  let current = 0;
  let expected = dates[0] === todayKey || dates[0] === dateKey(yesterday) ? dates[0] : "";
  if (expected) {
    for (const day of dates) {
      if (day !== expected) break;
      current += 1;
      const prior = new Date(`${expected}T12:00:00`);
      prior.setDate(prior.getDate() - 1);
      expected = dateKey(prior);
    }
  }

  let longest = 0;
  let run = 0;
  let previous: Date | null = null;
  for (const day of [...dates].reverse()) {
    const currentDate = new Date(`${day}T12:00:00`);
    if (previous) {
      const difference = Math.round((currentDate.getTime() - previous.getTime()) / 86_400_000);
      run = difference === 1 ? run + 1 : 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    previous = currentDate;
  }
  return { current, longest, totalDays: dates.length };
};

export const normalizeProfileUrl = (value: string, domain: "github.com" | "linkedin.com") => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.hostname !== domain && !parsed.hostname.endsWith(`.${domain}`)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const avatarMimeExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const PROFILE_AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export const getProfileAvatarExtension = (mimeType: string) => avatarMimeExtensions[mimeType] || null;

export const validateProfileAvatarFile = (mimeType: string, size: number) => {
  if (!getProfileAvatarExtension(mimeType)) return "Please upload a JPG, PNG, or WEBP image smaller than 5 MB.";
  if (size <= 0) return "The selected image is empty.";
  if (size >= PROFILE_AVATAR_MAX_BYTES) return "Profile photo must be smaller than 5 MB.";
  return null;
};
