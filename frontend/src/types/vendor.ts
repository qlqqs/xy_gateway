import type { BaseEntity, TableQuery } from './index';

export type VendorType = 'openai' | 'anthropic' | 'google' | 'aliyun' | 'aliyun_coding' | 'volcengine_coding' | 'deepseek' | 'mimo' | 'mimo_token_plan' | 'opencode_go' | 'other';

export type VendorAuthMode = 'api_key' | 'bearer_token';

export type VendorProxyType = 'http' | 'socks5';

export type VendorStatus = 'active' | 'disabled';

export type VendorApiType = 'openai' | 'anthropic';

export type OpenAiProtocol = 'chat_completions' | 'responses';

export interface VendorProxyConfig {
    type: VendorProxyType;
    url: string;
}

export interface VendorUrls {
    [key: string]: string;
}

export interface VendorConfig {
    auth_mode?: VendorAuthMode;
    skip_tls_verify?: boolean;
    supplier_name?: string;
    channel_code?: string;
    api_type?: VendorApiType;
    openai_protocol?: OpenAiProtocol;
    status?: VendorStatus;
    remark?: string;
    available_models?: string[];
    concurrency?: number;
    load_factor?: number | null;
    priority?: number;
    group_id?: number | null;
    proxy?: VendorProxyConfig | null;
}

export interface Vendor extends BaseEntity {
    type: VendorType;
    name: string;
    token: string;
    urls: VendorUrls;
    config: VendorConfig;
    model_count: number;
}

export interface CreateVendorRequest {
    type: VendorType;
    name: string;
    token: string;
    urls?: VendorUrls;
    config?: VendorConfig;
}

export interface UpdateVendorRequest {
    type?: VendorType;
    name?: string;
    token?: string;
    urls?: VendorUrls;
    config?: VendorConfig;
}

export interface VendorQuery extends TableQuery {
    type?: VendorType;
}

export interface VendorModel {
    id: number;
    vendor_id: number;
    model_id: string;
    allowed_formats: string[] | null;
    created_at: string;
    updated_at: string;
}
