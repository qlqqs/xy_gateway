import request from '../utils/request';
import type { ListResponse } from '../types';
import type { RechargeRecord, RechargeRecordsQuery } from '../types/billing';

export async function listRechargeRecords(params?: RechargeRecordsQuery): Promise<ListResponse<RechargeRecord>> {
    return request.get('/balance/recharge/list.json', { params });
}
