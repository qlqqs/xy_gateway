import { ApiFormat } from "../../constants";
import type { SgVendor } from "../../model/sgVendor";

class ModelRoutingResult {
    constructor(
        readonly vendor: SgVendor | null,
        readonly vendorModelName: string | null,
        readonly upstreamFormat: ApiFormat,
        readonly priority: number = 1,
        readonly weight: number = 1,
        readonly sortOrder: number = 0,
        readonly vendorModelId: number | null = null,
    ) {}

    static none(): ModelRoutingResult {
        // upstreamFormat 为占位值：none() 无上游，不会被健康过滤查询
        return new ModelRoutingResult(null, null, ApiFormat.OPENAI);
    }

    hasUpstream(): this is ModelRoutingResult & {
        vendor: SgVendor;
        vendorModelName: string;
    } {
        return this.vendor != null && this.vendorModelName != null;
    }
}

export { ModelRoutingResult };
