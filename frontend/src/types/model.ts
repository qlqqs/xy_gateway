import type { BaseEntity, TableQuery } from './index';

/** 模型价格的计费模式，与渠道定价保持一致。 */
export type ModelBillingMode = 'token' | 'per_request' | 'image';

export interface ModelUpstreamConfig {
    vendor_id: number;
    vendor_model_id?: number;
    enabled: boolean;
}

export interface ModelUpstreamFormValue {
    vendor_id?: number;
    vendor_model_id?: number;
    enabled: boolean;
}

/** 模型管理表单只维护供应商与上游模型的映射。 */
export interface ModelMapping {
    upstreams: ModelUpstreamConfig[];
}

export interface ModelPrices {
    billing_mode?: ModelBillingMode;
    input?: number;
    output?: number;
    cache_write?: number;
    cache_read?: number;
    image_input?: number;
    image_output?: number;
    per_request?: number;
}

export interface Model extends BaseEntity {
    name: string;
    mapping: ModelMapping;
    enable: boolean;
    prices?: ModelPrices | null;
}

export interface ModelMappingRequest {
    name: string;
    enable: boolean;
    prices?: ModelPrices | null;
    mapping: ModelMapping;
}

export type CreateModelRequest = ModelMappingRequest;

export type UpdateModelRequest = CreateModelRequest;

export interface ModelQuery extends TableQuery {
    vendor_id?: number;
}
