import type { BaseEntity, PaginationParams } from './index';

export type RechargeRecordType = 'recharge' | 'adjustment';

export interface RechargeRecord extends BaseEntity {
    user_id: number;
    amount: number;
    type: RechargeRecordType;
    remark: string | null;
    operator: string | null;

    // 关联数据
    user_name?: string | null;
}

export interface RechargeRecordsQuery extends PaginationParams {
    user_id?: number;
    type?: RechargeRecordType;
}
