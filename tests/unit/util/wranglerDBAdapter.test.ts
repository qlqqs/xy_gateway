import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    execFileSync: vi.fn(),
}));

vi.mock("child_process", () => ({
    execFileSync: mocks.execFileSync,
}));

import { WranglerDBAdapter } from "../../../src/util/db/wranglerDBAdapter";

describe("WranglerDBAdapter", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.execFileSync.mockReturnValue("");
    });

    it("以独立参数传递多行迁移 SQL", () => {
        const adapter = new WranglerDBAdapter("--local", "wrangler.test.toml", "test-db");
        const sql = "-- migration comment\nCREATE TABLE example (id INTEGER);";

        adapter.exec(sql);

        expect(mocks.execFileSync).toHaveBeenCalledWith(
            process.platform === "win32" ? "npx.cmd" : "npx",
            [
                "wrangler",
                "d1",
                "execute",
                "test-db",
                "--local",
                "--config",
                "wrangler.test.toml",
                "--command",
                sql,
            ],
            { encoding: "utf-8", stdio: "pipe" },
        );
    });

    it("解析 Wrangler D1 JSON 查询结果", () => {
        mocks.execFileSync.mockReturnValue(JSON.stringify([{
            results: [{ id: 3 }],
            success: true,
        }]));
        const adapter = new WranglerDBAdapter("--remote", "", "test-db");

        expect(adapter.query<{ id: number }>("SELECT id FROM example")).toEqual([{ id: 3 }]);
        expect(mocks.execFileSync).toHaveBeenCalledWith(
            process.platform === "win32" ? "npx.cmd" : "npx",
            [
                "wrangler",
                "d1",
                "execute",
                "test-db",
                "--remote",
                "--json",
                "--command",
                "SELECT id FROM example",
            ],
            { encoding: "utf-8", stdio: "pipe" },
        );
    });
});
