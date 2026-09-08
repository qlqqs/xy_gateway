<template>
    <div class="vendor-list">
        <div class="table-header">
            <a-form layout="inline">
                <a-form-item label="名称">
                    <a-input
                        v-model:value="searchForm.keyword"
                        placeholder="搜索供应商名称"
                        allow-clear
                    />
                </a-form-item>
                <a-form-item label="类型">
                    <a-select
                        v-model:value="searchForm.type"
                        placeholder="全部"
                        style="width: 120px"
                        allow-clear
                    >
                        <a-select-option value="aliyun">Aliyun (通义千问)</a-select-option>
                        <a-select-option value="aliyun_coding">Aliyun Coding</a-select-option>
                        <a-select-option value="volcengine_coding">Volcengine Coding</a-select-option>
                        <a-select-option value="deepseek">DeepSeek</a-select-option>
                        <a-select-option value="mimo">Mimo</a-select-option>
                        <a-select-option value="mimo_token_plan">Mimo Token Plan</a-select-option>
                        <a-select-option value="opencode_go">OpenCode Go</a-select-option>
                        <a-select-option value="openrouter">OpenRouter</a-select-option>
                        <a-select-option value="openai">OpenAI</a-select-option>
                        <a-select-option value="anthropic">Anthropic</a-select-option>
                        <a-select-option value="google">Google</a-select-option>
                        <a-select-option value="other">Other</a-select-option>
                    </a-select>
                </a-form-item>
                <a-form-item>
                    <a-space>
                        <a-button type="primary" @click="handleSearch">搜索</a-button>
                        <a-button @click="handleReset">重置</a-button>
                    </a-space>
                </a-form-item>
            </a-form>
            <a-button type="primary" @click="handleCreate">新建供应商</a-button>
        </div>

        <a-table
            :columns="columns"
            :data-source="data"
            :loading="loading"
            :pagination="pagination"
            table-layout="fixed"
            @change="handleTableChange"
            :row-key="(record: Vendor) => record.id"
        >
            <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'type'">
                    <a-tag :color="getTypeColor(record.type)" :style="getTypeTagStyle(record.type)">
                        {{ getTypeLabel(record.type) }}
                    </a-tag>
                </template>
                <template v-if="column.key === 'created_at'">
                    {{ formatDate(record.created_at) }}
                </template>
                <template v-if="column.key === 'action'">
                    <a-space :size="0">
                        <a-tooltip title="编辑">
                            <a-button
                                type="text"
                                size="small"
                                class="vendor-action-button"
                                aria-label="编辑"
                                @click="handleEdit(record)"
                            >
                                <EditOutlined />
                            </a-button>
                        </a-tooltip>
                        <a-tooltip title="测试">
                            <a-button
                                type="text"
                                size="small"
                                class="vendor-action-button"
                                aria-label="测试"
                                @click="handleTest(record)"
                            >
                                <ExperimentOutlined />
                            </a-button>
                        </a-tooltip>
                        <a-tooltip title="删除">
                            <a-button
                                danger
                                type="text"
                                size="small"
                                aria-label="删除"
                                @click="handleDelete(record)"
                            >
                                <DeleteOutlined />
                            </a-button>
                        </a-tooltip>
                    </a-space>
                </template>
            </template>
        </a-table>
    </div>

    <DialogCreate ref="createDialogRef" @success="handleCreateSuccess" />
    <DialogEdit ref="editDialogRef" @success="handleEditSuccess" />
    <DialogTest ref="testDialogRef" />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { TableColumnsType } from 'ant-design-vue';
import {
    DeleteOutlined,
    EditOutlined,
    ExperimentOutlined,
} from '@ant-design/icons-vue';
import { Modal } from 'ant-design-vue/es';
import vendorsStore from '@/stores/vendors';
import modelsStore from '@/stores/models';
import groupsStore from '@/stores/groups';
import { useResourceTable } from '@/composables/useResourceTable';
import { formatDate } from '@/utils/format';
import DialogCreate from './DialogCreate.vue';
import DialogEdit from './DialogEdit.vue';
import DialogTest from './DialogTest.vue';
import type { Vendor, VendorQuery, VendorType } from '@/types/vendor';
import { notifyRequestError, notifySuccess, notifyWarning } from '@/utils/requestFeedback';

const { loading, data, pagination, searchForm, loadData, handleSearch, handleReset, handleTableChange } = useResourceTable<Vendor, VendorQuery>({
    initialSearchForm: {
        keyword: undefined,
        type: undefined,
    },
    fetcher: vendorsStore.list,
    resetSearchForm: (form) => {
        form.keyword = undefined;
        form.type = undefined;
    },
});

const createDialogRef = ref();
const editDialogRef = ref();
const testDialogRef = ref();

const columns: TableColumnsType<Vendor> = [
    { title: 'ID', key: 'id', dataIndex: 'id', width: '16.6667%' },
    { title: '类型', key: 'type', dataIndex: 'type', width: '16.6667%' },
    { title: '名称', key: 'name', dataIndex: 'name', width: '16.6667%' },
    { title: '模型数量', key: 'model_count', dataIndex: 'model_count', width: '16.6667%' },
    { title: '创建时间', key: 'created_at', dataIndex: 'created_at', width: '16.6667%' },
    { title: '操作', key: 'action', width: '16.6667%' },
];

function handleCreate() {
    createDialogRef.value?.open();
}

async function handleCreateSuccess() {
    const [groupRefresh] = await Promise.allSettled([groupsStore.refresh()]);
    if (groupRefresh.status === 'rejected') {
        notifyWarning('供应商已创建，但分组统计刷新失败，请刷新页面');
    }
    void loadData();
}

async function handleEdit(record: Vendor) {
    try {
        const vendor = await vendorsStore.fetch(record.id);
        if (!vendor) throw new Error('供应商不存在');
        editDialogRef.value?.open(vendor);
    } catch (error) {
        notifyRequestError(error, '加载供应商失败');
    }
}

async function handleEditSuccess() {
    const refreshResults = await Promise.allSettled([
        modelsStore.refresh(),
        groupsStore.refresh(),
    ]);
    if (refreshResults.some(result => result.status === 'rejected')) {
        notifyWarning('供应商已更新，但关联数据刷新失败，请刷新页面');
    }
    void loadData();
}

function handleTest(record: Vendor) {
    testDialogRef.value?.openVendorTest(record);
}

function handleDelete(record: Vendor) {
    Modal.confirm({
        title: '确认删除',
        content: `确定要删除供应商 "${record.name}" 吗？后端会自动清理模型映射和供应商模型。`,
        okText: '确定',
        cancelText: '取消',
        okType: 'danger',
        onOk: async () => {
            try {
                const result = await vendorsStore.remove(record.id);
                if (!result.success) {
                    throw new Error('供应商不存在');
                }
                const refreshResults = await Promise.allSettled([
                    modelsStore.refresh(),
                    groupsStore.refresh(),
                ]);
                if (refreshResults.some(result => result.status === 'rejected')) {
                    notifyWarning('供应商已删除，但关联数据刷新失败，请刷新页面');
                } else {
                    notifySuccess('删除成功');
                }
                void loadData();
            } catch (error) {
                notifyRequestError(error, '删除失败');
            }
        },
    });
}

function getTypeLabel(type: VendorType): string {
    const labels: Record<VendorType, string> = {
        aliyun: 'Aliyun (通义千问)',
        aliyun_coding: 'Aliyun Coding',
        volcengine_coding: 'Volcengine Coding',
        deepseek: 'DeepSeek',
        mimo: 'Mimo',
        mimo_token_plan: 'Mimo Token Plan',
        opencode_go: 'OpenCode Go',
        openrouter: 'OpenRouter',
        openai: 'OpenAI',
        anthropic: 'Anthropic',
        google: 'Google',
        other: 'Other',
    };
    return labels[type] || type;
}

function getTypeColor(type: VendorType): string {
    const colors: Record<VendorType, string> = {
        aliyun: 'orange',
        aliyun_coding: 'orange',
        volcengine_coding: 'purple',
        deepseek: '',
        mimo: 'blue',
        mimo_token_plan: 'blue',
        opencode_go: 'cyan',
        openrouter: 'blue',
        openai: 'green',
        anthropic: 'orange',
        google: '',
        other: 'default',
    };
    return colors[type] || 'default';
}

function getTypeTagStyle(type: VendorType) {
    if (type === 'deepseek' || type === 'google') {
        return {
            color: 'var(--accent-primary)',
            backgroundColor: 'var(--accent-primary-soft)',
            borderColor: 'var(--accent-primary-border)',
        };
    }
    return undefined;
}
</script>

<style scoped>
.vendor-list {
    background: var(--bg-page);
    padding: 24px;
}

.table-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 16px;
}

.vendor-action-button {
    color: var(--accent-primary);
}
</style>
