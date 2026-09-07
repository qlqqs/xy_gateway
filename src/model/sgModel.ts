import { Model } from "sutando";
import { inspect, InspectOptions } from "util";
import { ModelBillingMode, MIN_MODEL_PRICE, PRICE_UNIT_TOKENS } from "../constants";
import customError from "../util/customErrorUtil";

const MODEL_BILLING_MODES = new Set<ModelBillingMode>(Object.values(ModelBillingMode));

class ModelUpstreamConfig {
    vendor_id: number = 0;
    vendor_model_id?: number;
    enabled: boolean = true;
    sort_order?: number;

    constructor(data?: Partial<ModelUpstreamConfig>) {
        if (data?.vendor_id !== undefined) this.vendor_id = data.vendor_id;
        if (data?.vendor_model_id !== undefined) this.vendor_model_id = data.vendor_model_id;
        if (data?.enabled !== undefined) this.enabled = data.enabled;
        if (data?.sort_order !== undefined) this.sort_order = data.sort_order;
    }

    toJSON() {
        return {
            vendor_id: this.vendor_id,
            ...(this.vendor_model_id !== undefined ? { vendor_model_id: this.vendor_model_id } : {}),
            enabled: this.enabled,
            ...(this.sort_order !== undefined ? { sort_order: this.sort_order } : {}),
        };
    }
}

/**
 * Scheduler value object kept as a type-level utility for internal callers.
 * It is deliberately not mapped to a model column; routing is driven by the
 * normalized `mapping.upstreams` relation.
 */
class ModelFailoverConfig {
    enabled = true;

    constructor(data?: Partial<ModelFailoverConfig>) {
        if (typeof data?.enabled === "boolean") this.enabled = data.enabled;
    }

    toJSON() {
        return { enabled: this.enabled };
    }
}

class ModelRoutingConfig {
    upstreams: ModelUpstreamConfig[] = [];
    failover = new ModelFailoverConfig();
    load_balance_strategy: "user" | "request" = "request";

    constructor(data?: {
        upstreams?: Array<ModelUpstreamConfig | Partial<ModelUpstreamConfig>>;
        failover?: ModelFailoverConfig | Partial<ModelFailoverConfig>;
        load_balance_strategy?: "user" | "request";
    }) {
        this.upstreams = (data?.upstreams ?? []).map(item => (
            item instanceof ModelUpstreamConfig ? item : new ModelUpstreamConfig(item)
        ));
        if (data?.failover) {
            this.failover = data.failover instanceof ModelFailoverConfig
                ? data.failover
                : new ModelFailoverConfig(data.failover);
        }
        if (data?.load_balance_strategy) this.load_balance_strategy = data.load_balance_strategy;
    }

    toJSON() {
        return {
            upstreams: this.upstreams.map(item => item.toJSON()),
            failover: this.failover.toJSON(),
            load_balance_strategy: this.load_balance_strategy,
        };
    }
}

class SgModel extends Model {
    table = "model";

    id!: number;

    name!: string | null;
    enable!: boolean;
    prices!: {
        billing_mode?: ModelBillingMode;
        input?: number;
        output?: number;
        cache_write?: number;
        cache_read?: number;
        image_input?: number;
        image_output?: number;
        per_request?: number;
        [key: string]: unknown;
    } | null;
    /** Canonical management representation; hydrated by modelManager/modelService. */
    // Hydrated relation, intentionally not persisted as a model column.
    // Initializing it on the instance keeps Sutando's Proxy setter from
    // treating assignments as an unknown database attribute.
    mapping: { upstreams: ModelUpstreamConfig[] } = { upstreams: [] };

    casts = {
        prices: "json",
    };

    created_at!: Date;
    updated_at!: Date;

    constructor(attributes: Record<string, unknown> = {}) {
        super();
        this.fill({
            enable: true,
            prices: {},
            ...attributes,
        });
    }

    getMapping(): { upstreams: ModelUpstreamConfig[] } {
        return {
            upstreams: (this.mapping?.upstreams ?? []).map(upstream => new ModelUpstreamConfig(upstream)),
        };
    }

    /** @deprecated Use getMapping(); no legacy database field is consulted. */
    getRoutingConfig(): ModelRoutingConfig {
        return new ModelRoutingConfig({
            upstreams: this.mapping?.upstreams ?? [],
            failover: { enabled: true },
            load_balance_strategy: "request",
        });
    }

    // 价格单位为每百万 token；价格允许 0（免费）或 >= MIN_MODEL_PRICE，其余值拒绝
    validatePrices(): void {
        const prices = this.prices;
        if (!prices) {
            return;
        }
        for (const [key, value] of Object.entries(prices)) {
            if (value === undefined || value === null) {
                continue;
            }
            if (key === "billing_mode") {
                if (typeof value !== "string" || !MODEL_BILLING_MODES.has(value as ModelBillingMode)) {
                    throw new customError.AppError(
                        `Billing mode must be one of ${[...MODEL_BILLING_MODES].join(", ")}`,
                        400,
                    );
                }
                continue;
            }
            if (key === "intervals") {
                continue;
            }
            if (
                typeof value !== "number"
                || !Number.isFinite(value)
                || value < 0
                || (value > 0 && value < MIN_MODEL_PRICE)
            ) {
                throw new customError.AppError(
                    `Price "${key}" must be 0 (free) or >= ${MIN_MODEL_PRICE} (per ${PRICE_UNIT_TOKENS} tokens)`,
                    400,
                );
            }
        }
    }

    // 是否启用计费：任一价格字段 > 0 视为计费；未设置或全部为 0 视为免费
    hasBilling(): boolean {
        const prices = this.prices;
        if (!prices) {
            return false;
        }
        return Object.values(prices).some(value => typeof value === "number" && value > 0);
    }

    [inspect.custom](depth: number, options: InspectOptions) {
        return JSON.stringify(this.toData(), null, 2);
    }
}

export { SgModel, ModelUpstreamConfig, ModelRoutingConfig, ModelFailoverConfig };
