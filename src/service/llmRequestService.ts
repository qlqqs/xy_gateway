import { ApiFormat } from "../constants";
import { SgModel } from "../model/sgModel";
import customError from "../util/customErrorUtil";
import modelManager from "../manager/modelManager";
import recordService from "./recordService";
import type { RecordCreateMetadata } from "./recordService";


interface LlmRequestContext {
    modelConfig: SgModel;
}


async function resolveContext(
    userId: number | null,
    modelName: string,
    body: string,
    format: ApiFormat,
    metadata: RecordCreateMetadata = {},
): Promise<LlmRequestContext> {
    const modelConfig = await modelManager.getModel(modelName, true);
    if (modelConfig == null) {
        await recordService.recordFailedRequest(userId, modelName, body, format, "model_not_found", null, metadata);
        throw new customError.NotFoundError("model not found");
    }

    return { modelConfig };
}

export default { resolveContext };
