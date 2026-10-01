import { describe, expect, it } from "vitest";
import { getProfileAvatarExtension, getStreakStats, normalizeProfileUrl, PROFILE_AVATAR_MAX_BYTES, validateProfileAvatarFile } from "@/lib/profileUtils";

describe("profile activity helpers", () => {
  it("calculates current, longest, and total learning-day streaks", () => {
    expect(getStreakStats(
      ["2026-10-01", "2026-09-30", "2026-09-28", "2026-09-27"],
      new Date(2026, 9, 1),
    )).toEqual({ current: 2, longest: 2, totalDays: 4 });
  });

  it("does not count an old learning streak as current", () => {
    expect(getStreakStats(["2026-09-20", "2026-09-19"], new Date(2026, 9, 1)))
      .toEqual({ current: 0, longest: 2, totalDays: 2 });
  });

  it("accepts safe links for the matching social host only", () => {
    expect(normalizeProfileUrl("github.com/octocat", "github.com")).toBe("https://github.com/octocat");
    expect(normalizeProfileUrl("https://www.linkedin.com/in/octocat", "linkedin.com")).toBe("https://www.linkedin.com/in/octocat");
    expect(normalizeProfileUrl("https://github.com.attacker.test/octocat", "github.com")).toBeNull();
    expect(normalizeProfileUrl("javascript:alert(1)", "github.com")).toBeNull();
    expect(normalizeProfileUrl("", "github.com")).toBe("");
  });

  it("accepts only JPEG, PNG, and WEBP avatars below the 5 MB limit", () => {
    expect(getProfileAvatarExtension("image/jpeg")).toBe("jpg");
    expect(getProfileAvatarExtension("image/png")).toBe("png");
    expect(getProfileAvatarExtension("image/webp")).toBe("webp");
    expect(validateProfileAvatarFile("image/svg+xml", 10)).toMatch(/JPG, PNG, or WEBP/);
    expect(validateProfileAvatarFile("image/jpeg", PROFILE_AVATAR_MAX_BYTES)).toMatch(/smaller than 5 MB/);
    expect(validateProfileAvatarFile("image/png", 1024)).toBeNull();
  });
});
