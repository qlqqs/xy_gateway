import { Model } from "sutando";
import { inspect, InspectOptions } from "util";

class SgUserGroup extends Model {
    table = "user_group";

    id!: number;
    name!: string;
    description!: string;
    inbound_protocols!: string[];
    custom_models!: string[];
    whitelist_enabled!: boolean;
    rate_multiplier!: number;
    status!: "active" | "disabled";
    created_at!: Date;
    updated_at!: Date;

    casts = {
        inbound_protocols: "json",
        custom_models: "json",
        whitelist_enabled: "boolean",
        rate_multiplier: "float",
    };

    constructor(attributes: Record<string, unknown> = {}) {
        super();
        this.fill({
            description: "",
            inbound_protocols: [],
            custom_models: [],
            whitelist_enabled: false,
            rate_multiplier: 1,
            status: "active",
            ...attributes,
        });
    }

    [inspect.custom](depth: number, options: InspectOptions) {
        return JSON.stringify(this.toData(), null, 2);
    }
}

export { SgUserGroup };
