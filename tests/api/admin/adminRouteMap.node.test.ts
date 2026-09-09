import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import adminApiRoutes from "../../../src/routes/adminApiRoutes";

const ADMIN_PREFIX = "/api/v1/admin";

function routeKey(method: string, path: string): string {
    return `${method.toUpperCase()} ${path}`;
}

function readAdminRouteKeys(): string[] {
    const source = readFileSync(resolve(process.cwd(), "src/routes.ts"), "utf8");
    const keys: string[] = [];
    const pattern = /app\.(get|post|put|delete)\("([^"]+)"\s*,\s*authMiddleware\.requireAdmin\b/g;
    for (const match of source.matchAll(pattern)) {
        keys.push(routeKey(match[1], match[2]));
    }
    return keys;
}

describe("Admin API route map", () => {
    it("keeps the 67 external and legacy method/path mappings in lockstep", () => {
        const map = adminApiRoutes.adminApiRouteMap;
        const externalKeys = map.map(spec => routeKey(spec.method, spec.externalPath));
        const legacyKeys = map.map(spec => routeKey(spec.method, spec.legacyPath));
        const sourceKeys = readAdminRouteKeys();

        expect(map).toHaveLength(67);
        expect(new Set(externalKeys).size).toBe(67);
        expect(new Set(legacyKeys).size).toBe(67);
        expect(sourceKeys).toHaveLength(67);
        expect(new Set(sourceKeys).size).toBe(67);
        expect([...legacyKeys].sort()).toEqual([...sourceKeys].sort());
    });

    it("uses fixed Node Admin paths without .json and excludes non-admin routes", () => {
        const map = adminApiRoutes.adminApiRouteMap;

        expect(map.every(spec => spec.externalPath.startsWith("/"))).toBe(true);
        expect(map.every(spec => !spec.externalPath.endsWith(".json"))).toBe(true);
        expect(map.every(spec => typeof spec.handler === "function")).toBe(true);
        expect(map.every(spec => spec.legacyPath.startsWith("/"))).toBe(true);

        const mountedPaths = map.map(spec => `${ADMIN_PREFIX}${spec.externalPath}`);
        expect(mountedPaths.every(path => path.startsWith(`${ADMIN_PREFIX}/`))).toBe(true);

        const legacyPaths = new Set(map.map(spec => spec.legacyPath));
        expect(legacyPaths.has("/welcome")).toBe(false);
        expect(legacyPaths.has("/test/cache/clear")).toBe(false);
        expect([...legacyPaths].some(path => path.startsWith("/v1/"))).toBe(false);
        expect([...legacyPaths].some(path => path.startsWith("/llm/v1/"))).toBe(false);
    });

    it("counts lifecycle and single-key additions separately from the legacy baseline", () => {
        const map = adminApiRoutes.adminApiRouteMap;
        const lifecycle = map.filter(spec => spec.legacyPath.startsWith("/admin-api-key/")
            || spec.legacyPath === "/admin-api-key.json");
        const singleKey = map.filter(spec => spec.externalPath.includes("/api-keys/")
            || (spec.externalPath.endsWith("/api-keys") && spec.method !== "put"));

        expect(lifecycle).toHaveLength(3);
        expect(singleKey).toHaveLength(5);
        expect(map.length - lifecycle.length - singleKey.length).toBe(59);
    });
});
