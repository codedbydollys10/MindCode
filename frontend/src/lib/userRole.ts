export type UserRole = "student";

export const normalizeUserRole = (_value: unknown): UserRole => "student";

export const getUserRoleFromUser = (_user: unknown): UserRole => "student";
