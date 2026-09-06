import type { TablePaginationConfig } from 'ant-design-vue';

export interface PaginationParams {
    page?: number;
    pageSize?: number;
}

export interface TableQuery extends PaginationParams {
    keyword?: string;
}

export interface TablePaginationState extends TablePaginationConfig {
    current: number;
    pageSize: number;
    total: number;
    showSizeChanger: boolean;
    showQuickJumper: boolean;
    pageSizeOptions: string[];
}

export interface ListResponse<T> {
    list: T[];
    total: number;
}

export interface BaseEntity {
    id: number;
    created_at: Date;
    updated_at: Date;
}
