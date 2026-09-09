/** Execute a non-blocking task without delaying the current response. */
export function runInBackground(task: () => Promise<void>): void {
    void task().catch(error => {
        console.error("[runInBackground] Error in background task:", error);
    });
}
