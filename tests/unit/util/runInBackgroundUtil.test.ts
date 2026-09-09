import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runInBackground } from "../../../src/util/runInBackgroundUtil";

describe("runInBackgroundUtil", () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it("starts the task without delaying the caller", async () => {
        const task = vi.fn().mockResolvedValue(undefined);

        runInBackground(task);

        expect(task).toHaveBeenCalledOnce();
        await Promise.resolve();
        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("logs task failures", async () => {
        const error = new Error("Task failed");
        const task = vi.fn().mockRejectedValue(error);

        runInBackground(task);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            "[runInBackground] Error in background task:",
            error,
        );
    });
});
