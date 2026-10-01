import { describe, expect, it } from "vitest";
import { getUserRoleFromUser, normalizeUserRole } from "./userRole";

describe("trusted account roles", () => {
  it("recognizes only the server-managed teacher role", () => {
    expect(getUserRoleFromUser({ app_metadata: { role: "teacher" } })).toBe("teacher");
    expect(getUserRoleFromUser({ app_metadata: { role: "student" } })).toBe("student");
    expect(getUserRoleFromUser({ app_metadata: { role: "admin" } })).toBe("student");
  });

  it("defaults users without trusted metadata to student", () => {
    expect(getUserRoleFromUser(null)).toBe("student");
    expect(getUserRoleFromUser({ user_metadata: { role: "teacher" } })).toBe("student");
    expect(normalizeUserRole(undefined)).toBe("student");
  });
});
