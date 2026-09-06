type StoredParser<T> = (value: unknown) => T;

function clone<T>(value: T): T {
    return structuredClone(value);
}

function load<T>(key: string, seed: T, parser?: StoredParser<T>): T {
    if (typeof localStorage === 'undefined') {
        return clone(seed);
    }

    try {
        const raw = localStorage.getItem(key);
        if (!raw) {
            return clone(seed);
        }

        const parsed: unknown = JSON.parse(raw);
        return parser ? parser(parsed) : (parsed as T);
    } catch {
        return clone(seed);
    }
}

function save<T>(key: string, value: T): void {
    if (typeof localStorage === 'undefined') {
        return;
    }

    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // localStorage 可能被禁用或已满；内存状态仍然可以继续工作。
    }
}

function clear(key: string): void {
    if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
    }
}

export default {
    load,
    save,
    clear,
};
