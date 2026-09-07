/**
 * In-process concurrency leases.
 *
 * Node/Tauri deployments get an exact cap.  Worker isolates and horizontally
 * scaled Node processes cannot share this map; callers must therefore treat it
 * as best-effort there (the limitation is documented in the domain design).
 */

export type LeaseScope = "key" | "vendor";

export interface ConcurrencyLease {
    readonly scope: LeaseScope;
    readonly id: number;
    readonly acquired: boolean;
    release(): void;
}

const active = new Map<string, number>();

function leaseKey(scope: LeaseScope, id: number): string {
    return `${scope}:${id}`;
}

function acquire(scope: LeaseScope, id: number, limit: number): ConcurrencyLease | null {
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const normalizedLimit = Number(limit);
    const key = leaseKey(scope, id);
    const current = active.get(key) ?? 0;
    if (Number.isFinite(normalizedLimit) && normalizedLimit > 0 && current >= normalizedLimit) {
        return null;
    }
    active.set(key, current + 1);
    let released = false;
    return {
        scope,
        id,
        acquired: true,
        release() {
            if (released) return;
            released = true;
            const count = active.get(key) ?? 0;
            if (count <= 1) active.delete(key);
            else active.set(key, count - 1);
        },
    };
}

function current(scope: LeaseScope, id: number): number {
    return active.get(leaseKey(scope, id)) ?? 0;
}

function clear(): void {
    active.clear();
}

export default { acquire, current, clear };

