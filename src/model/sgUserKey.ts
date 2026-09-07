import { Model } from "sutando";
import { inspect, InspectOptions } from "util";
import { MicroAmountCast } from "../util/protocol/billingUtil";

/** Persisted API key. The plain value is intentionally not a database column. */
class SgUserKey extends Model {
    table = "user_key";

    id!: number;
    user_id!: number;
    group_id!: number | null;
    name!: string;
    status!: "active" | "disabled";
    key_hash!: string;
    key_prefix!: string;
    encrypted_value!: string;
    /** Optional write-only/response value populated by the key service. */
    value?: string;
    model_whitelist_enabled!: boolean;
    model_whitelist!: string[];
    ip_restriction_enabled!: boolean;
    ip_whitelist!: string[];
    ip_blacklist!: string[];
    quota!: number;
    quota_used!: number;
    concurrency_limit!: number;
    expires_at!: Date | null;
    last_used_at!: Date | null;
    created_at!: Date;
    updated_at!: Date;

    casts = {
        model_whitelist_enabled: "boolean",
        model_whitelist: "json",
        ip_restriction_enabled: "boolean",
        ip_whitelist: "json",
        ip_blacklist: "json",
        quota: MicroAmountCast,
        quota_used: MicroAmountCast,
        expires_at: "datetime",
        last_used_at: "datetime",
    };

    constructor(attributes: Record<string, unknown> = {}) {
        super();
        this.fill({
            status: "active",
            model_whitelist_enabled: false,
            model_whitelist: [],
            ip_restriction_enabled: false,
            ip_whitelist: [],
            ip_blacklist: [],
            quota: 0,
            quota_used: 0,
            concurrency_limit: 0,
            ...attributes,
        });
    }

    [inspect.custom](depth: number, options: InspectOptions) {
        const data = this.toData();
        delete (data as Record<string, unknown>).encrypted_value;
        delete (data as Record<string, unknown>).key_hash;
        delete (data as Record<string, unknown>).value;
        return JSON.stringify(data, null, 2);
    }
}

export { SgUserKey };
