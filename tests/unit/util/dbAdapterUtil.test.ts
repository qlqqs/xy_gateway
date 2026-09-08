import { describe, expect, it, vi } from "vitest";
import { D1Adapter } from "../../../src/util/dbAdapterUtil";

function fakeD1() {
    const bind = vi.fn().mockReturnValue({ kind: "prepared" });
    const prepare = vi.fn().mockReturnValue({ bind });
    const batch = vi.fn().mockResolvedValue([]);
    return {
        db: { prepare, batch } as unknown as D1Database,
        prepare,
        bind,
        batch,
    };
}

describe("D1Adapter batch", () => {
    it("捕获创建执行器时的请求 binding", async () => {
        const first = fakeD1();
        const second = fakeD1();
        const adapter = new D1Adapter(first.db);
        const execute = adapter.captureBatchExecutor(first.db);

        adapter.setDB(second.db);
        await execute([{ sql: "SELECT ?", bindings: [7] }]);

        expect(first.prepare).toHaveBeenCalledWith("SELECT ?");
        expect(first.bind).toHaveBeenCalledWith(7);
        expect(first.batch).toHaveBeenCalledWith([{ kind: "prepared" }]);
        expect(second.prepare).not.toHaveBeenCalled();
        expect(second.batch).not.toHaveBeenCalled();
    });
});
