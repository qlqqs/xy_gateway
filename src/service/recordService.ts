import { SgRecord } from "../model/sgRecord";
import { SgRecordStatus, ApiFormat, ConfigKey, ROOT_USER_ID } from "../constants";
import recordManager, { type RecordUpdateData } from "../manager/recordManager";
import objectStorageService from "./objectStorageService";
import configService from "./configService";

interface RecordPayload {
    request: string | null;
    response: string | null;
}

export interface RecordCreateMetadata {
    keyId?: number | null;
    groupId?: number | null;
    requestedModel?: string | null;
    billingMode?: string | null;
    baseCost?: number;
    rateMultiplier?: number;
    settlementStatus?: string;
}

const RECORD_PAYLOAD_PREFIX = "record/";

function isLogEnabled(): boolean {
    return process.env.RECORD_LOG_ENABLED === "true";
}

async function isPayloadRecordingEnabled(): Promise<boolean> {
    return (await configService.getConfig(ConfigKey.RECORD_PAYLOAD_ENABLED)).getBoolean();
}

function storageKey(recordId: number): string {
    return `${RECORD_PAYLOAD_PREFIX}${recordId}`;
}

async function readPayload(recordId: number): Promise<RecordPayload> {
    const raw = await objectStorageService.getText(storageKey(recordId));
    if (!raw) {
        return { request: null, response: null };
    }
    try {
        const parsed = JSON.parse(raw) as Partial<RecordPayload>;
        return {
            request: parsed.request ?? null,
            response: parsed.response ?? null,
        };
    } catch (e) {
        console.error(`[RecordService] Failed to parse stored payload for record ${recordId}:`, e);
        return { request: null, response: null };
    }
}

async function writePayload(recordId: number, payload: RecordPayload): Promise<void> {
    await objectStorageService.putText(storageKey(recordId), JSON.stringify(payload));
}

async function attachPayload(record: SgRecord): Promise<SgRecord> {
    const payload = await readPayload(Number(record.id));
    record.request_data = payload.request;
    record.response_data = payload.response;
    return record;
}

async function clearPayloads(): Promise<number> {
    return objectStorageService.deleteByPrefix(RECORD_PAYLOAD_PREFIX);
}

// 一条用户请求 = 一条 record：进入路由循环前创建，此时还不知道命中的上游
// 上游信息（vendor_id / vendor_model_name / upstream_format）由后续每次上游尝试 update 覆盖
async function create(
    userId: number | null,
    modelId: number | null,
    requestData: string | null,
    clientFormat: string | null = null,
    metadata: RecordCreateMetadata = {},
) {
    // The legacy record schema keeps user_id NOT NULL and has no foreign key
    // to the user table.  Root/diagnostic requests have no persisted user
    // row, so use the reserved ROOT_USER_ID sentinel instead of attempting to
    // insert SQL NULL (which would fail before a failed request can be logged).
    const persistedUserId = userId ?? ROOT_USER_ID;
    if (isLogEnabled()) {
        console.log(`[RecordService] Creating record: user=${persistedUserId}, model=${modelId}`);
        if (requestData) {
            console.log(`[RecordService] Request data: ${requestData}`);
        }
    }

    const record = await recordManager.create({
        user_id: persistedUserId,
        model_id: modelId,
        vendor_id: null,
        vendor_model_name: null,
        status: SgRecordStatus.INIT,
        client_format: clientFormat,
        upstream_format: null,
        first_token_latency: null,
        start_at: new Date(),
        end_at: null,
        cost: 0,
        key_id: metadata.keyId ?? null,
        group_id: metadata.groupId ?? null,
        requested_model: metadata.requestedModel ?? null,
        billing_mode: metadata.billingMode ?? null,
        base_cost: metadata.baseCost ?? 0,
        rate_multiplier: metadata.rateMultiplier ?? 1,
        settlement_status: metadata.settlementStatus ?? "pending",
    });

    if (await isPayloadRecordingEnabled()) {
        await writePayload(Number(record.id), {
            request: requestData ?? null,
            response: null,
        });
    }

    return record;
}

async function update(recordId: number, data: RecordUpdateData) {
    if (isLogEnabled()) {
        console.log(`[RecordService] Updating record ${recordId}:`, JSON.stringify(data, null, 2));
    }

    // response_data 存在对象存储，写入表前先落存储
    if (Object.prototype.hasOwnProperty.call(data, "response_data")) {
        if (await isPayloadRecordingEnabled()) {
            const payload = await readPayload(recordId);
            payload.response = (data as any).response_data ?? null;
            await writePayload(recordId, payload);
        }
    }

    return recordManager.update(recordId, data);
}

async function latest(limit: number = 10, summaryOnly: boolean = false) {
    const records = await recordManager.latest(limit, summaryOnly);

    if (!summaryOnly) {
        await Promise.all(records.map((r: SgRecord) => attachPayload(r)));
    }
    return records;
}

async function recordFailedRequest(
    userId: number | null,
    modelName: string | null,
    body: string,
    clientFormat: ApiFormat,
    failedCode: string,
    modelId: number | null = null,
    metadata: RecordCreateMetadata = {},
) {
    try {
        const record = await create(
            userId,
            modelId,
            body,
            clientFormat,
            {
                ...metadata,
                requestedModel: metadata.requestedModel ?? modelName,
                settlementStatus: "skipped",
                baseCost: 0,
                rateMultiplier: metadata.rateMultiplier ?? 1,
            },
        );
        await update(record.id, {
            status: SgRecordStatus.FAILED,
            failed_code: failedCode,
            settlement_status: "skipped",
            cost: 0,
            end_at: new Date(),
        });
    } catch (e) {
        console.error("Failed to write failed record:", e);
    }
}

export default {
    create,
    update,
    latest,
    recordFailedRequest,
    attachPayload,
    clearPayloads,
};
