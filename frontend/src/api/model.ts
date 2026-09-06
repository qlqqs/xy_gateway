import request from '../utils/request';
import type { Model } from '../types/model';
import type { VendorTestResponse } from '../api/vendor';

export async function fetchModelsByIds(ids: number[]): Promise<Model[]> {
    return request.post('/model/batch.json', { ids });
}

export async function getModel(id: number): Promise<Model> {
    return request.get(`/model/${id}`);
}

// 模型路由测试：走真实网关路由 + failover，返回上游实际请求快照与上游响应
export async function testModelRoute(model: string, format: string): Promise<VendorTestResponse> {
    return request.post('/model/route-test.json', { model, format });
}
