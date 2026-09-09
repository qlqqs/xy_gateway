import { describe, expect, it, vi } from "vitest";
import { SQLiteAdapter } from "../../../src/util/dbAdapterUtil";

describe("database adapters", () => {
    it("delegates SQLite statements to the underlying database", () => {
        const statement = {
            all: vi.fn().mockReturnValue([{ id: 1 }]),
            get: vi.fn().mockReturnValue({ id: 1 }),
            run: vi.fn().mockReturnValue({ changes: 1 }),
        };
        const db = {
            exec: vi.fn(),
            prepare: vi.fn().mockReturnValue(statement),
        };
        const adapter = new SQLiteAdapter(db);

        adapter.exec("CREATE TABLE example (id INTEGER)");
        const prepared = adapter.prepare("SELECT * FROM example WHERE id = ?");

        expect(db.exec).toHaveBeenCalledWith("CREATE TABLE example (id INTEGER)");
        expect(db.prepare).toHaveBeenCalledWith("SELECT * FROM example WHERE id = ?");
        expect(prepared.all()).toEqual([{ id: 1 }]);
        expect(prepared.first()).toEqual({ id: 1 });
        expect(prepared.run(1)).toEqual({ changes: 1 });
        expect(statement.all).toHaveBeenCalledOnce();
        expect(statement.get).toHaveBeenCalledOnce();
        expect(statement.run).toHaveBeenCalledWith(1);
    });
});
