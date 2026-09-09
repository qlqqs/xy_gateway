import { Hono, MiddlewareHandler } from "hono";
import type { Env, Variables } from "../routes";
import authMiddleware from "../middleware/authMiddleware";
import adminKeyController from "../controller/adminKeyController";
import systemController from "../controller/systemController";
import configController from "../controller/configController";
import clientConfigController from "../controller/clientConfigController";
import groupController from "../controller/groupController";
import vendorController from "../controller/vendorController";
import vendorModelController from "../controller/vendorModelController";
import modelController from "../controller/modelController";
import userController from "../controller/userController";
import balanceController from "../controller/balanceController";
import recordController from "../controller/recordController";
import recordActivityController from "../controller/recordActivityController";
import statsController from "../controller/statsController";
import ormService from "../service/ormService";

type AdminApiEnv = { Bindings: Env; Variables: Variables };
type AdminApiMethod = "get" | "post" | "put" | "delete";

interface AdminApiRouteSpec {
    method: AdminApiMethod;
    externalPath: string;
    legacyPath: string;
    handler: MiddlewareHandler<AdminApiEnv>;
}


/** 未知路径和不支持方法共用的 JSON 响应。 */
function notFound(c: Parameters<MiddlewareHandler<AdminApiEnv>>[0]): Response {
    return c.json({ error: "Not found" }, 404);
}


const adminApiRoutes = new Hono<AdminApiEnv>();

// 外部管理入口仅支持 Node。门禁位于子应用内部，避免 Worker/D1 请求进入
// Admin Key 或普通管理 Controller。
const nodeOnly: MiddlewareHandler<AdminApiEnv> = async (c, next) => {
    if (!ormService.isNode) {
        return c.json({ error: "Not found" }, 404);
    }
    await next();
};

// 所有子应用路径共享认证；未知路径在认证通过后才返回 JSON 404。
adminApiRoutes.use("*", nodeOnly);
adminApiRoutes.use("*", authMiddleware.requireAdmin);
adminApiRoutes.use("*", async (c, next) => {
    if (c.req.path.endsWith(".json")) {
        return notFound(c);
    }
    await next();
});
// Hono 会把未单独注册的 HEAD 自动回退到 GET；Admin API 不声明 HEAD，
// 因此在认证之后显式拒绝，避免错误方法执行只读 Controller。
adminApiRoutes.use("*", async (c, next) => {
    if (c.req.method === "HEAD") {
        return notFound(c);
    }
    await next();
});

/**
 * 为现有 requireAdmin 管理路由和 Admin Key 生命周期建立显式外部别名。
 * legacyPath 仅用于审查和测试，运行时不会根据请求值选择 handler。
 */
const adminApiRouteMap: AdminApiRouteSpec[] = [
    // Admin Key 生命周期
    {
        method: "get",
        externalPath: "/settings/admin-api-key",
        legacyPath: "/admin-api-key/status.json",
        handler: adminKeyController.status,
    },
    {
        method: "post",
        externalPath: "/settings/admin-api-key/regenerate",
        legacyPath: "/admin-api-key/regenerate.json",
        handler: adminKeyController.regenerate,
    },
    {
        method: "delete",
        externalPath: "/settings/admin-api-key",
        legacyPath: "/admin-api-key.json",
        handler: adminKeyController.remove,
    },

    // 系统与普通配置
    {
        method: "get",
        externalPath: "/status",
        legacyPath: "/status.json",
        handler: systemController.status,
    },
    {
        method: "get",
        externalPath: "/update",
        legacyPath: "/update.json",
        handler: systemController.checkUpdate,
    },
    {
        method: "get",
        externalPath: "/settings",
        legacyPath: "/config.json",
        handler: configController.getConfig,
    },
    {
        method: "put",
        externalPath: "/settings",
        legacyPath: "/config.json",
        handler: configController.updateConfig,
    },
    {
        method: "get",
        externalPath: "/client-config/status",
        legacyPath: "/client-config/status.json",
        handler: clientConfigController.status,
    },

    // 客户端配置
    {
        method: "get",
        externalPath: "/client-config/local",
        legacyPath: "/client-config/local.json",
        handler: clientConfigController.readLocal,
    },
    {
        method: "post",
        externalPath: "/client-config/create",
        legacyPath: "/client-config/create.json",
        handler: clientConfigController.create,
    },
    {
        method: "post",
        externalPath: "/client-config/backup",
        legacyPath: "/client-config/backup.json",
        handler: clientConfigController.backup,
    },
    {
        method: "post",
        externalPath: "/client-config/backup/rename",
        legacyPath: "/client-config/backup/rename.json",
        handler: clientConfigController.renameBackup,
    },
    {
        method: "post",
        externalPath: "/client-config/backup/delete",
        legacyPath: "/client-config/backup/delete.json",
        handler: clientConfigController.deleteBackup,
    },
    {
        method: "post",
        externalPath: "/client-config/backup/update",
        legacyPath: "/client-config/backup/update.json",
        handler: clientConfigController.updateBackup,
    },
    {
        method: "post",
        externalPath: "/client-config/apply",
        legacyPath: "/client-config/apply.json",
        handler: clientConfigController.apply,
    },
    {
        method: "post",
        externalPath: "/client-config/sync-from-local",
        legacyPath: "/client-config/sync-from-local.json",
        handler: clientConfigController.syncFromLocal,
    },

    // 分组
    {
        method: "get",
        externalPath: "/groups",
        legacyPath: "/group/list.json",
        handler: groupController.listGroups,
    },
    {
        method: "post",
        externalPath: "/groups",
        legacyPath: "/group/create.json",
        handler: groupController.createGroup,
    },
    {
        method: "get",
        externalPath: "/groups/:id",
        legacyPath: "/group/:id",
        handler: groupController.getGroup,
    },
    {
        method: "put",
        externalPath: "/groups/:id",
        legacyPath: "/group/:id",
        handler: groupController.updateGroup,
    },
    {
        method: "delete",
        externalPath: "/groups/:id",
        legacyPath: "/group/:id",
        handler: groupController.deleteGroup,
    },

    // 供应商与供应商模型。静态路径排在动态 ID 之前。
    {
        method: "get",
        externalPath: "/vendors/preset-urls",
        legacyPath: "/vendor/preset-urls.json",
        handler: vendorController.getPresetUrls,
    },
    {
        method: "post",
        externalPath: "/vendors/models/fetch",
        legacyPath: "/vendor/models/fetch.json",
        handler: vendorController.fetchModelsPreview,
    },
    {
        method: "get",
        externalPath: "/vendors",
        legacyPath: "/vendor/list.json",
        handler: vendorController.listVendors,
    },
    {
        method: "post",
        externalPath: "/vendors/batch",
        legacyPath: "/vendor/batch.json",
        handler: vendorController.getVendorsByIds,
    },
    {
        method: "post",
        externalPath: "/vendors",
        legacyPath: "/vendor/create.json",
        handler: vendorController.createVendor,
    },
    {
        method: "post",
        externalPath: "/vendor-models/batch",
        legacyPath: "/vendor-model/batch.json",
        handler: vendorModelController.getVendorModelsByIds,
    },
    {
        method: "get",
        externalPath: "/vendors/:id/models",
        legacyPath: "/vendor/:id/model/list.json",
        handler: vendorModelController.listVendorModels,
    },
    {
        method: "get",
        externalPath: "/vendors/:id/models/fetch",
        legacyPath: "/vendor/:id/model/fetch.json",
        handler: vendorModelController.fetchVendorModels,
    },
    {
        method: "post",
        externalPath: "/vendors/:id/models/sync",
        legacyPath: "/vendor/:id/model/sync.json",
        handler: vendorModelController.syncVendorModels,
    },
    {
        method: "post",
        externalPath: "/vendors/:id/models",
        legacyPath: "/vendor/:id/model/add.json",
        handler: vendorModelController.addVendorModel,
    },
    {
        method: "put",
        externalPath: "/vendors/:id/models/:modelId",
        legacyPath: "/vendor/:id/model/:modelId",
        handler: vendorModelController.updateVendorModel,
    },
    {
        method: "delete",
        externalPath: "/vendors/:id/models/:modelId",
        legacyPath: "/vendor/:id/model/:modelId",
        handler: vendorModelController.deleteVendorModel,
    },
    {
        method: "get",
        externalPath: "/vendors/:id",
        legacyPath: "/vendor/:id",
        handler: vendorController.getVendor,
    },
    {
        method: "post",
        externalPath: "/vendors/:id/test",
        legacyPath: "/vendor/:id/test.json",
        handler: vendorController.testVendor,
    },
    {
        method: "put",
        externalPath: "/vendors/:id",
        legacyPath: "/vendor/:id",
        handler: vendorController.updateVendor,
    },
    {
        method: "delete",
        externalPath: "/vendors/:id",
        legacyPath: "/vendor/:id",
        handler: vendorController.deleteVendor,
    },

    // 网关模型
    {
        method: "post",
        externalPath: "/models",
        legacyPath: "/model/create.json",
        handler: modelController.createModel,
    },
    {
        method: "post",
        externalPath: "/models/route-test",
        legacyPath: "/model/route-test.json",
        handler: modelController.testModelRoute,
    },
    {
        method: "get",
        externalPath: "/models",
        legacyPath: "/model/list.json",
        handler: modelController.listModels,
    },
    {
        method: "post",
        externalPath: "/models/batch",
        legacyPath: "/model/batch.json",
        handler: modelController.getModelsByIds,
    },
    {
        method: "get",
        externalPath: "/models/:id",
        legacyPath: "/model/:id",
        handler: modelController.getModel,
    },
    {
        method: "put",
        externalPath: "/models/:id",
        legacyPath: "/model/:id",
        handler: modelController.updateModel,
    },
    {
        method: "delete",
        externalPath: "/models/:id",
        legacyPath: "/model/:id",
        handler: modelController.deleteModel,
    },

    // 用户与余额
    {
        method: "get",
        externalPath: "/users",
        legacyPath: "/user/list.json",
        handler: userController.listUsers,
    },
    {
        method: "post",
        externalPath: "/users/batch",
        legacyPath: "/user/batch.json",
        handler: userController.getUsersByIds,
    },
    {
        method: "get",
        externalPath: "/users/:id",
        legacyPath: "/user/:id",
        handler: userController.getUser,
    },
    {
        method: "post",
        externalPath: "/users",
        legacyPath: "/user/create.json",
        handler: userController.createUser,
    },
    {
        method: "put",
        externalPath: "/users/:id",
        legacyPath: "/user/:id",
        handler: userController.updateUser,
    },
    {
        method: "put",
        externalPath: "/users/:id/api-keys",
        legacyPath: "/user/:id/keys.json",
        handler: userController.updateKeys,
    },
    {
        method: "get",
        externalPath: "/users/:id/api-keys",
        legacyPath: "/user/:id/keys.json",
        handler: userController.listKeys,
    },
    {
        method: "post",
        externalPath: "/users/:id/api-keys",
        legacyPath: "/user/:id/keys.json",
        handler: userController.createKey,
    },
    {
        method: "get",
        externalPath: "/users/:id/api-keys/:keyId",
        legacyPath: "/user/:id/keys/:keyId/detail.json",
        handler: userController.getKey,
    },
    {
        method: "put",
        externalPath: "/users/:id/api-keys/:keyId",
        legacyPath: "/user/:id/keys/:keyId/detail.json",
        handler: userController.updateKey,
    },
    {
        method: "delete",
        externalPath: "/users/:id/api-keys/:keyId",
        legacyPath: "/user/:id/keys/:keyId/detail.json",
        handler: userController.deleteKey,
    },
    {
        method: "post",
        externalPath: "/users/:id/balance",
        legacyPath: "/user/:id/balance/adjust.json",
        handler: userController.adjustBalance,
    },
    {
        method: "get",
        externalPath: "/balance/recharges",
        legacyPath: "/balance/recharge/list.json",
        handler: balanceController.listRechargeRecords,
    },
    {
        method: "get",
        externalPath: "/balance/recharges/:id",
        legacyPath: "/balance/recharge/:id",
        handler: balanceController.getRechargeRecord,
    },

    // 请求记录与活动。静态路径排在 /records/:id 之前。
    {
        method: "get",
        externalPath: "/records/latest",
        legacyPath: "/record/latest.json",
        handler: recordController.latestRecords,
    },
    {
        method: "delete",
        externalPath: "/records/payload",
        legacyPath: "/record/clear-payload",
        handler: recordController.clearPayload,
    },
    {
        method: "delete",
        externalPath: "/records",
        legacyPath: "/record/clear-all",
        handler: recordController.clearAll,
    },
    {
        method: "get",
        externalPath: "/records",
        legacyPath: "/record/list.json",
        handler: recordController.listRecords,
    },
    {
        method: "get",
        externalPath: "/records/:id/activity",
        legacyPath: "/record/:id/activity.json",
        handler: recordActivityController.getRecordActivity,
    },
    {
        method: "get",
        externalPath: "/records/:id",
        legacyPath: "/record/:id",
        handler: recordController.getRecord,
    },
    {
        method: "delete",
        externalPath: "/records/:id",
        legacyPath: "/record/:id",
        handler: recordController.deleteRecord,
    },

    // 统计
    {
        method: "get",
        externalPath: "/stats/dashboard",
        legacyPath: "/stats/dashboard.json",
        handler: statsController.dashboardStats,
    },
    {
        method: "get",
        externalPath: "/stats/recent",
        legacyPath: "/stats/recent.json",
        handler: statsController.recentRecords,
    },
];


function registerRoute(spec: AdminApiRouteSpec): void {
    switch (spec.method) {
        case "get":
            adminApiRoutes.get(spec.externalPath, spec.handler);
            return;
        case "post":
            adminApiRoutes.post(spec.externalPath, spec.handler);
            return;
        case "put":
            adminApiRoutes.put(spec.externalPath, spec.handler);
            return;
        case "delete":
            adminApiRoutes.delete(spec.externalPath, spec.handler);
            return;
    }
}


for (const spec of adminApiRouteMap) {
    registerRoute(spec);
}

// app.route() 挂载子应用时不会复制 notFound 回调，因此用终止式通配路由
// 保证未知外部路径始终返回 JSON。
adminApiRoutes.all("*", notFound);


export default {
    app: adminApiRoutes,
    adminApiRouteMap,
};
