import { Model } from "sutando";
import { inspect, InspectOptions } from "util";

class SgModelUpstream extends Model {
    table = "model_upstream";

    id!: number;
    model_id!: number;
    vendor_id!: number;
    vendor_model_id!: number | null;
    enabled!: boolean;
    sort_order!: number;
    created_at!: Date;
    updated_at!: Date;

    casts = {
        enabled: "boolean",
    };

    constructor(attributes: Record<string, unknown> = {}) {
        super();
        this.fill({ enabled: true, sort_order: 0, ...attributes });
    }

    [inspect.custom](depth: number, options: InspectOptions) {
        return JSON.stringify(this.toData(), null, 2);
    }
}

export { SgModelUpstream };
