export type UserRole = "student" | "teacher";

export const normalizeUserRole = (value: unknown): UserRole => value === "teacher" ? "teacher" : "student";

export const getUserRoleFromUser = (value: unknown): UserRole => {
  if (!value || typeof value !== "object" || !("app_metadata" in value)) return "student";
  const appMetadata = value.app_metadata;
  if (!appMetadata || typeof appMetadata !== "object" || !("role" in appMetadata)) return "student";
  return normalizeUserRole(appMetadata.role);
};
