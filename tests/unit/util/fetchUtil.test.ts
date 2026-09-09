import { describe, it, expect, vi } from "vitest";
import fetchUtil from "../../../src/util/fetchUtil";

const undiciImport = vi.hoisted(() => ({
    count: 0,
}));

vi.mock("undici", async () => {
    undiciImport.count += 1;
    return vi.importActual("undici");
});

describe("fetchUtil.getDispatcher", () => {
    it("returns undefined when no config provided", async () => {
        const dispatcher = await fetchUtil.getDispatcher();
        expect(dispatcher).toBeUndefined();
        expect(undiciImport.count).toBe(0);
    });

    it("returns undefined when skip_tls_verify is false and no proxy", async () => {
        const dispatcher = await fetchUtil.getDispatcher({ skip_tls_verify: false });
        expect(dispatcher).toBeUndefined();
        expect(undiciImport.count).toBe(0);
    });

    it("returns an Agent when skip_tls_verify is true", async () => {
        const dispatcher = await fetchUtil.getDispatcher({ skip_tls_verify: true });
        expect(dispatcher).toBeDefined();
        expect(undiciImport.count).toBeGreaterThan(0);
        // undici Agent 实例特征：有 dispatch / close / destroy 等方法
        expect(typeof (dispatcher as any).dispatch).toBe("function");
    });

    it("reuses the same Agent instance on multiple calls", async () => {
        const firstDispatcher = await fetchUtil.getDispatcher({ skip_tls_verify: true });
        const secondDispatcher = await fetchUtil.getDispatcher({ skip_tls_verify: true });
        expect(firstDispatcher).toBe(secondDispatcher);
    });
});
