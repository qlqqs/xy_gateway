import request from '../utils/request';
import type { Vendor, VendorModel } from '../types/vendor';

export interface VendorTestResponse {
    success: boolean;
    status?: number;
    duration?: number;
    url?: string;
    converted_from?: string;
    converted_to?: string;
    proxy?: { type: string; url: string };
    request_method?: string;
    request_headers?: Record<string, string>;
    request_body?: unknown;
    response?: unknown;
    error?: unknown;
}

export async function fetchVendorsByIds(ids: number[]): Promise<Vendor[]> {
    return request.post('/vendor/batch.json', { ids });
}

export async function getVendor(id: number): Promise<Vendor> {
    return request.get(`/vendor/${id}`);
}

export async function listVendorModels(vendorId: number): Promise<VendorModel[]> {
    return request.get(`/vendor/${vendorId}/model/list.json`);
}

export async function testVendor(
    id: number,
    format: string = 'openai',
    model?: string,
    autoConvert: boolean = false,
): Promise<VendorTestResponse> {
    return request.post(`/vendor/${id}/test.json`, { format, model, auto_convert: autoConvert });
}
