import { describe, expect, it } from "vitest";
import securityEntranceUtil from "../../../src/util/securityEntranceUtil";


describe("securityEntranceUtil", () => {
    it("normalizes a configured entrance to a path", () => {
        expect(securityEntranceUtil.normalizeSecurityEntrance("/fdsafhdvd/")).toBe("/fdsafhdvd");
        expect(securityEntranceUtil.normalizeSecurityEntrance("fdsafhdvd")).toBe("/fdsafhdvd");
    });

    it("reads the configured environment variable", () => {
        expect(securityEntranceUtil.getConfiguredSecurityEntrance({
            SECURE_LOGIN_ENTRY: "/canonical",
        })).toBe("/canonical");
    });

    it("accepts only the configured path and its trailing-slash form", () => {
        expect(securityEntranceUtil.isSecurityEntrancePath("/fdsafhdvd", "/fdsafhdvd")).toBe(true);
        expect(securityEntranceUtil.isSecurityEntrancePath("/fdsafhdvd/", "/fdsafhdvd")).toBe(true);
        expect(securityEntranceUtil.isSecurityEntrancePath("/login", "/fdsafhdvd")).toBe(false);
    });

    it("allows all paths when no entrance is configured", () => {
        expect(securityEntranceUtil.isSecurityEntrancePath("/", "")).toBe(true);
        expect(securityEntranceUtil.isSecurityEntrancePath("/login", "")).toBe(true);
    });

    it("reads an encoded authentication token from cookies", () => {
        expect(securityEntranceUtil.getCookieValue(
            "theme=dark; adminToken=token%2Bvalue; other=value",
            securityEntranceUtil.SECURITY_AUTH_COOKIE,
        )).toBe("token+value");
    });

    it("does not accept a malformed or missing authentication cookie", () => {
        expect(securityEntranceUtil.getCookieValue("adminToken=%E0%A4%A", "adminToken")).toBe("");
        expect(securityEntranceUtil.getCookieValue("theme=dark", "adminToken")).toBe("");
    });

});
