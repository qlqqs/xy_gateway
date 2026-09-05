<template>
    <div class="group-list">
        <div class="table-header">
            <a-form layout="inline">
                <a-form-item label="分组名称">
                    <a-input
                        v-model:value="keyword"
                        placeholder="搜索分组名称"
                        allow-clear
                    />
                </a-form-item>
                <a-form-item label="状态">
                    <a-select v-model:value="status" placeholder="全部" allow-clear style="width: 120px">
                        <a-select-option value="active">已启用</a-select-option>
                        <a-select-option value="disabled">已停用</a-select-option>
                    </a-select>
                </a-form-item>
                <a-form-item>
                    <a-space>
                        <a-button type="primary" @click="applyFilter">搜索</a-button>
                        <a-button @click="resetFilter">重置</a-button>
                    </a-space>
                </a-form-item>
            </a-form>
            <a-button type="primary" @click="openCreate">
                <PlusOutlined />
                新建分组
            </a-button>
        </div>

        <a-table
            :columns="columns"
            :data-source="filteredGroups"
            :pagination="{ pageSize: 10, showSizeChanger: true }"
            :row-key="(record: GroupRecord) => record.id"
            table-layout="fixed"
        >
            <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'name'">
                    <div class="group-name">{{ record.name }}</div>
                    <div class="group-description">{{ record.description || '暂无描述' }}</div>
                </template>
                <template v-else-if="column.key === 'status'">
                    <a-tag :color="record.status === 'active' ? 'success' : 'default'">
                        {{ record.status === 'active' ? '已启用' : '已停用' }}
                    </a-tag>
                </template>
                <template v-else-if="column.key === 'channelCount'">{{ record.channelCount }}</template>
                <template v-else-if="column.key === 'rateMultiplier'">{{ record.rateMultiplier.toFixed(2) }}×</template>
                <template v-else-if="column.key === 'action'">
                    <a-space :size="0">
                        <a-tooltip title="编辑">
                            <a-button type="text" size="small" aria-label="编辑" class="action-button" @click="openEdit(record)">
                                <EditOutlined />
                            </a-button>
                        </a-tooltip>
                        <a-tooltip title="删除">
                            <a-button danger type="text" size="small" aria-label="删除" @click="removeGroup(record)">
                                <DeleteOutlined />
                            </a-button>
                        </a-tooltip>
                    </a-space>
                </template>
            </template>
        </a-table>
    </div>

    <a-modal
        v-model:open="dialogOpen"
        :title="editingId === null ? '新建分组' : '编辑分组'"
        @ok="saveGroup"
        @cancel="closeDialog"
    >
        <a-form ref="formRef" :model="formState" :rules="rules" layout="vertical">
            <a-form-item label="分组名称" name="name">
                <a-input v-model:value="formState.name" placeholder="请输入分组名称" :maxlength="64" />
            </a-form-item>
            <a-form-item label="描述" name="description">
                <a-textarea v-model:value="formState.description" placeholder="可选，描述分组用途" :rows="3" :maxlength="200" show-count />
            </a-form-item>
            <a-form-item label="允许的入站协议" name="inboundProtocols" extra="至少选择一种客户端协议">
                <a-select v-model:value="formState.inboundProtocols" mode="multiple" :options="inboundProtocolOptions" placeholder="请选择入站协议" />
            </a-form-item>
            <a-form-item label="模型访问范围">
                <a-switch v-model:checked="formState.whitelistEnabled" checked-children="白名单" un-checked-children="全部模型" />
                <div class="field-hint">开启后，仅允许自定义模型列表中的模型访问。</div>
            </a-form-item>
            <a-form-item label="自定义模型列表" extra="可多选；仅作为 /v1/models 展示与白名单候选，不随访问范围开关联动">
                <a-select v-model:value="formState.customModels" mode="multiple" :options="modelOptions" placeholder="请选择模型" option-filter-prop="label" />
            </a-form-item>
            <a-form-item label="计费倍率" extra="请求费用 = 供应商费用 × 分组倍率">
                <a-input-number v-model:value="formState.rateMultiplier" :min="0" :max="100" :step="0.05" :precision="2" addon-after="×" style="width: 180px" />
            </a-form-item>
            <a-form-item label="状态" name="status">
                <a-radio-group v-model:value="formState.status">
                    <a-radio value="active">启用</a-radio>
                    <a-radio value="disabled">停用</a-radio>
                </a-radio-group>
            </a-form-item>
        </a-form>
    </a-modal>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { TableColumnsType } from 'ant-design-vue';
import type { FormInstance } from 'ant-design-vue/es';
import { Modal, message } from 'ant-design-vue/es';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons-vue';
import groupStore, { type GroupRecord, type GroupStatus, type InboundProtocol } from '@/stores/groups';

const columns: TableColumnsType<GroupRecord> = [
    { title: 'ID', key: 'id', dataIndex: 'id', width: '14.2857%' },
    { title: '分组信息', key: 'name', dataIndex: 'name', width: '14.2857%' },
    { title: '通道数', key: 'channelCount', dataIndex: 'channelCount', width: '14.2857%' },
    { title: '倍率', key: 'rateMultiplier', width: '14.2857%' },
    { title: '状态', key: 'status', dataIndex: 'status', width: '14.2857%' },
    { title: '更新时间', key: 'updatedAt', dataIndex: 'updatedAt', width: '14.2857%' },
    { title: '操作', key: 'action', width: '14.2857%' },
];

const groups = groupStore.groups;
const keyword = ref('');
const status = ref<GroupStatus>();
const appliedKeyword = ref('');
const appliedStatus = ref<GroupStatus>();
const dialogOpen = ref(false);
const editingId = ref<number | null>(null);
const formRef = ref<FormInstance>();
const formState = reactive({
    name: '',
    description: '',
    inboundProtocols: ['openai_responses'] as InboundProtocol[],
    customModels: [] as string[],
    whitelistEnabled: false,
    rateMultiplier: 1,
    status: 'active',
});
const inboundProtocolOptions = [
    { label: 'OpenAI Responses（/v1/responses）', value: 'openai_responses' },
    { label: 'OpenAI Chat Completions（/v1/chat/completions）', value: 'openai_chat' },
    { label: 'Anthropic Messages（/v1/messages）', value: 'anthropic' },
];
const modelOptions = [
    { label: 'gpt-4o', value: 'gpt-4o' },
    { label: 'gpt-4o-mini', value: 'gpt-4o-mini' },
    { label: 'claude-sonnet-4-20250514', value: 'claude-sonnet-4-20250514' },
    { label: 'claude-3-7-sonnet-latest', value: 'claude-3-7-sonnet-latest' },
    { label: 'gemini-2.5-pro', value: 'gemini-2.5-pro' },
    { label: 'deepseek-chat', value: 'deepseek-chat' },
];
const rules = {
    name: [{ required: true, message: '请输入分组名称' }],
    inboundProtocols: [{ validator: () => formState.inboundProtocols.length > 0 ? Promise.resolve() : Promise.reject(new Error('至少选择一种入站协议')) }],
};

const filteredGroups = computed(() => {
    const query = appliedKeyword.value.trim().toLowerCase();
    return groups.value.filter(group => {
        const matchesKeyword = !query || group.name.toLowerCase().includes(query) || group.description.toLowerCase().includes(query);
        const matchesStatus = !appliedStatus.value || group.status === appliedStatus.value;
        return matchesKeyword && matchesStatus;
    });
});

function applyFilter() {
    appliedKeyword.value = keyword.value;
    appliedStatus.value = status.value;
}

function resetFilter() {
    keyword.value = '';
    status.value = undefined;
    applyFilter();
}

function openCreate() {
    editingId.value = null;
    formState.name = '';
    formState.description = '';
    formState.inboundProtocols = ['openai_responses'];
    formState.customModels = [];
    formState.whitelistEnabled = false;
    formState.rateMultiplier = 1;
    formState.status = 'active';
    dialogOpen.value = true;
}

function openEdit(group: GroupRecord) {
    editingId.value = group.id;
    formState.name = group.name;
    formState.description = group.description;
    formState.inboundProtocols = [...group.inboundProtocols];
    formState.customModels = [...group.customModels];
    formState.whitelistEnabled = group.whitelistEnabled;
    formState.rateMultiplier = group.rateMultiplier;
    formState.status = group.status;
    dialogOpen.value = true;
}

async function saveGroup() {
    try {
        await formRef.value?.validate();
    } catch {
        return;
    }

    const now = new Date().toLocaleString('zh-CN', { hour12: false });
    const payload = {
        ...formState,
        status: formState.status as GroupStatus,
    };
    if (editingId.value === null) {
        const nextId = Math.max(0, ...groups.value.map(group => group.id)) + 1;
        groups.value.unshift({ ...payload, id: nextId, channelCount: 0, updatedAt: now });
        message.success('分组已创建');
    } else {
        const group = groups.value.find(item => item.id === editingId.value);
        if (group) Object.assign(group, { ...payload, updatedAt: now });
        message.success('分组已更新');
    }
    closeDialog();
}

function closeDialog() {
    dialogOpen.value = false;
}

function removeGroup(group: GroupRecord) {
    Modal.confirm({
        title: '确认删除',
        content: `确定要删除分组“${group.name}”吗？`,
        okText: '删除',
        cancelText: '取消',
        okType: 'danger',
        onOk: () => {
            groups.value = groups.value.filter(item => item.id !== group.id);
            message.success('分组已删除');
        },
    });
}
</script>

<style scoped>
.group-list {
    padding: 24px;
    background: var(--bg-page);
}

.table-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
}

.group-name {
    color: var(--text-primary);
    font-weight: 500;
}

.group-description {
    margin-top: 4px;
    overflow: hidden;
    color: var(--text-secondary);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.field-hint {
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.5;
}

.action-button {
    color: var(--accent-primary);
}

@media (max-width: 768px) {
    .group-list {
        padding: 16px;
    }

    .table-header {
        flex-direction: column;
    }

    .table-header > .ant-btn {
        align-self: flex-end;
    }
}
</style>
