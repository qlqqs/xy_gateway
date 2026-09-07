import { randomUUID } from "crypto";

/**
 * User Test Data Fixtures
 */

// 测试环境预设的管理员 Token（唯一来源，各处统一引用，避免重复定义导致不一致）
const ADMIN_TOKEN = "admin-token-for-test";

const USER_FIXTURES = {
    basic: {
        name: "Test User",
        keys: [{ value: randomUUID() }],
    },
    admin: {
        name: "Admin User",
        keys: [{ value: ADMIN_TOKEN }],
        type: "admin",
    },
    withCustomKey: {
        name: "Test User with Custom API Key",
        keys: [{ value: "custom-key-123" }],
    },
    duplicateName1: {
        name: "Duplicate User",
        keys: [{ value: randomUUID() }],
    },
    duplicateName2: {
        name: "Duplicate User",
        keys: [{ value: randomUUID() }],
    },
    longName: {
        name: "A".repeat(255),
        keys: [{ value: randomUUID() }],
    },
    // 缺省 value 会由 userKeyService 生成新的随机 API key。
    emptyKey: {
        name: "Test User",
        keys: [{}],
    },
};

function createRandomUser(name?: string, keyValue?: string) {
    return {
        name: name || `Test User ${Date.now()}`,
        keys: [{ value: keyValue || randomUUID() }],
    };
}

export default {
    USER_FIXTURES,
    createRandomUser,
    ADMIN_TOKEN,
};
