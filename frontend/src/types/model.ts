import type { BaseEntity, TableQuery } from './index';

export type ModelRoutingMode = 'single' | 'load_balance' | 'first_available';

export type LoadBalanceStrategy = 'user' | 'request';

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

export interface ModelFailoverConfig {
    enabled: boolean;
}

export interface ModelRoutingConfig {
    upstreams: ModelUpstreamConfig[];
    failover: ModelFailoverConfig;
    load_balance_strategy?: LoadBalanceStrategy;
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
    routing_mode: ModelRoutingMode;
    routing_config: ModelRoutingConfig;
    enable: boolean;
    prices?: ModelPrices | null;
}

export type CreateModelRequest = Pick<
    Model,
    'name' | 'enable' | 'prices' | 'routing_mode' | 'routing_config'
>;

export type UpdateModelRequest = CreateModelRequest;

export interface ModelQuery extends TableQuery {
    vendor_id?: number;
}
