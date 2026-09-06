<template>
    <a-modal
        v-model:open="visible"
        title="管理用户 Key"
        width="820px"
        :confirm-loading="saving"
        @ok="handleOk"
        @cancel="handleCancel"
    >
        <a-alert
            v-if="user"
            type="info"
            show-icon
            :message="`用户：${user.name}`"
            class="user-hint"
        />

        <a-form :model="formState" layout="vertical" class="keys-form">
            <a-empty v-if="formState.keys.length === 0" description="暂无 Key，请添加一个 Key" />

            <a-collapse v-else v-model:active-key="activeKeys" :bordered="false">
                <a-collapse-panel v-for="(key, index) in formState.keys" :key="String(key.id)">
                    <template #header>
                        <div class="key-panel-header">
                            <span class="key-panel-title">{{ key.name || `Key ${index + 1}` }}</span>
                            <a-tag :color="key.status === 'active' ? 'success' : 'default'">
                                {{ key.status === 'active' ? '已启用' : '已禁用' }}
                            </a-tag>
                        </div>
                    </template>

                    <a-card size="small" class="key-card">
                        <template #extra>
                            <a-button
                                type="link"
                                danger
                                size="small"
                                html-type="button"
                                @click.stop="confirmRemoveKey(key.id)"
                            >
                                删除 Key
                            </a-button>
                        </template>

                        <a-row :gutter="16">
                            <a-col :xs="24" :md="12">
                                <a-form-item label="名称">
                                    <a-input
                                        v-model:value="key.name"
                                        placeholder="请输入 Key 名称"
                                        :maxlength="100"
                                    />
                                </a-form-item>
                            </a-col>
                            <a-col :xs="24" :md="12">
                                <a-form-item label="状态">
                                    <a-switch
                                        v-model:checked="key.status"
                                        aria-label="Key 状态"
                                        checked-children="启用"
                                        un-checked-children="禁用"
                                        checked-value="active"
                                        un-checked-value="disabled"
                                    />
                                </a-form-item>
                            </a-col>
                        </a-row>

                        <a-form-item label="Key 值">
                            <a-input-password v-model:value="key.value" readonly>
                                <template #addonAfter>
                                    <a-button type="link" size="small" html-type="button" @click="regenerateKey(key.id)">
                                        重新生成
                                    </a-button>
                                </template>
                            </a-input-password>
                        </a-form-item>

                        <a-form-item label="分组">
                            <a-select
                                v-model:value="key.groupId"
                                :options="groupOptions"
                                allow-clear
                                placeholder="请选择分组"
                            />
                        </a-form-item>

                        <a-divider orientation="left">访问限制</a-divider>
                        <a-form-item label="模型白名单">
                            <div class="switch-row">
                                <span>开启后仅允许所选模型使用此密钥</span>
                                <a-switch
                                    v-model:checked="key.modelWhitelistEnabled"
                                    aria-label="模型白名单开关"
                                    checked-children="开启"
                                    un-checked-children="关闭"
                                />
                            </div>
                        </a-form-item>
                        <a-form-item v-if="key.modelWhitelistEnabled" label="允许的模型">
                            <a-select
                                v-model:value="key.modelWhitelist"
                                mode="multiple"
                                :options="modelOptions(key.modelWhitelist)"
                                option-filter-prop="label"
                                placeholder="请选择允许使用的模型"
                            />
                        </a-form-item>

                        <a-form-item label="IP 限制">
                            <div class="switch-row">
                                <span>开启后仅允许白名单 IP，并拒绝黑名单 IP</span>
                                <a-switch
                                    v-model:checked="key.ipRestrictionEnabled"
                                    aria-label="IP 限制开关"
                                    checked-children="开启"
                                    un-checked-children="关闭"
                                />
                            </div>
                        </a-form-item>
                        <template v-if="key.ipRestrictionEnabled">
                            <a-form-item label="IP 白名单">
                                <a-textarea
                                    v-model:value="key.ipWhitelistText"
                                    :rows="3"
                                    class="monospace"
                                    placeholder="192.168.1.100&#10;10.0.0.0/8"
                                />
                                <div class="field-hint">每行一个 IP 或 CIDR，设置后仅允许这些 IP 使用此密钥。</div>
                            </a-form-item>
                            <a-form-item label="IP 黑名单">
                                <a-textarea
                                    v-model:value="key.ipBlacklistText"
                                    :rows="3"
                                    class="monospace"
                                    placeholder="1.2.3.4&#10;5.6.0.0/16"
                                />
                                <div class="field-hint">每行一个 IP 或 CIDR，这些 IP 将被禁止使用此密钥。</div>
                            </a-form-item>
                        </template>

                        <a-divider orientation="left">用量与有效期</a-divider>
                        <a-row :gutter="16">
                            <a-col :xs="24" :md="12">
                                <a-form-item label="额度限制">
                                    <a-input-number
                                        v-model:value="key.quota"
                                        :min="0"
                                        :step="0.01"
                                        :precision="2"
                                        style="width: 100%"
                                        addon-before="¥"
                                    />
                                    <div class="field-hint">设置此密钥可消费的最大金额。0 = 无限制。</div>
                                </a-form-item>
                            </a-col>
                            <a-col :xs="24" :md="12">
                                <a-form-item label="速率限制（限制并发）">
                                    <a-input-number
                                        v-model:value="key.rateLimit"
                                        :min="0"
                                        :step="1"
                                        :precision="0"
                                        style="width: 100%"
                                        addon-after="个并发"
                                    />
                                    <div class="field-hint">限制此密钥同时进行的请求数。0 = 无限制。</div>
                                </a-form-item>
                            </a-col>
                        </a-row>
                        <a-form-item label="密钥有效期">
                            <div class="switch-row expiration-toggle">
                                <span>关闭后密钥永不过期</span>
                                <a-switch
                                    v-model:checked="key.expirationEnabled"
                                    aria-label="密钥有效期开关"
                                    checked-children="开启"
                                    un-checked-children="关闭"
                                />
                            </div>
                            <a-input
                                v-if="key.expirationEnabled"
                                v-model:value="key.expiresAt"
                                type="datetime-local"
                                class="expiration-input"
                            />
                        </a-form-item>
                    </a-card>
                </a-collapse-panel>
            </a-collapse>

            <a-button type="dashed" block html-type="button" class="add-key-button" @click="addKey">
                <PlusOutlined /> 添加 Key
            </a-button>
        </a-form>
    </a-modal>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { Modal } from 'ant-design-vue/es';
import { PlusOutlined } from '@ant-design/icons-vue';
import userStore from '@/stores/users';
import groupStore from '@/stores/groups';
import modelsStore from '@/stores/models';
import type { User, UserKey, UserKeyInput } from '@/types/user';
import { notifyError, notifyRequestError, notifySuccess } from '@/utils/requestFeedback';

interface EditableKey extends UserKey {
    ipWhitelistText: string;
    ipBlacklistText: string;
    expirationEnabled: boolean;
    expiresAt: string;
}

interface KeyFormState {
    keys: EditableKey[];
}

const emit = defineEmits<{
    success: [user: User];
}>();

const visible = ref(false);
const saving = ref(false);
const user = ref<User | null>(null);
const userId = ref<number | null>(null);
const activeKeys = ref<string[]>([]);
const formState = reactive<KeyFormState>({ keys: [] });

const groupOptions = computed(() => groupStore.groups.value.map(group => ({
    label: group.status === 'active' ? group.name : `${group.name}（已停用）`,
    value: group.id,
})));

function modelOptions(selectedModels: string[]) {
    const selected = new Set(selectedModels);
    return modelsStore.models
        .filter(model => model.enable || selected.has(model.name))
        .map(model => ({ label: model.name, value: model.name }));
}

function toDateTimeLocal(value: string | null): string {
    if (!value) {
        return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDateTimeLocal(value: string): string {
    if (!value) {
        throw new Error('请选择密钥有效期');
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error('密钥有效期格式无效');
    }
    return date.toISOString();
}

function parseLines(value: string): string[] {
    return [...new Set(value.split(/\r?\n/).map(item => item.trim()).filter(Boolean))];
}

function toEditableKey(key: UserKey): EditableKey {
    return {
        ...key,
        modelWhitelist: [...key.modelWhitelist],
        ipWhitelist: [...key.ipWhitelist],
        ipBlacklist: [...key.ipBlacklist],
        ipWhitelistText: key.ipWhitelist.join('\n'),
        ipBlacklistText: key.ipBlacklist.join('\n'),
        expirationEnabled: key.expiresAt !== null,
        expiresAt: toDateTimeLocal(key.expiresAt),
    };
}

function createNewKey(): EditableKey {
    const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    return {
        id,
        value: crypto.randomUUID(),
        groupId: null,
        status: 'active',
        name: `Key ${formState.keys.length + 1}`,
        modelWhitelistEnabled: false,
        modelWhitelist: [],
        ipRestrictionEnabled: false,
        ipWhitelist: [],
        ipBlacklist: [],
        quota: 0,
        rateLimit: 0,
        expiresAt: '',
        ipWhitelistText: '',
        ipBlacklistText: '',
        expirationEnabled: false,
    };
}

function open(target: User): void {
    const current = userStore.get(target.id) ?? target;
    user.value = current;
    userId.value = current.id;
    formState.keys = current.keys.map(toEditableKey);
    activeKeys.value = formState.keys[0] ? [String(formState.keys[0].id)] : [];
    visible.value = true;
}

function addKey(): void {
    const key = createNewKey();
    formState.keys.push(key);
    activeKeys.value = [String(key.id)];
}

function regenerateKey(keyId: number): void {
    Modal.confirm({
        title: '确认重新生成 Key',
        content: '重新生成后，当前 Key 将立即失效。确定要继续吗？',
        okText: '确定',
        cancelText: '取消',
        onOk: () => {
            const key = formState.keys.find(item => item.id === keyId);
            if (key) {
                key.value = crypto.randomUUID();
                notifySuccess('新 Key 已生成，请保存后生效');
            }
        },
    });
}

function confirmRemoveKey(keyId: number): void {
    const key = formState.keys.find(item => item.id === keyId);
    if (!key) {
        return;
    }

    Modal.confirm({
        title: '确认删除 Key',
        content: `确定要删除“${key.name || key.value}”吗？删除后保存才会生效。`,
        okText: '删除',
        cancelText: '取消',
        okType: 'danger',
        onOk: () => {
            formState.keys = formState.keys.filter(item => item.id !== keyId);
            activeKeys.value = activeKeys.value.filter(id => id !== String(keyId));
        },
    });
}

function toPayload(key: EditableKey): UserKeyInput {
    return {
        id: key.id,
        value: key.value.trim(),
        groupId: key.groupId,
        status: key.status,
        name: key.name.trim(),
        modelWhitelistEnabled: key.modelWhitelistEnabled,
        modelWhitelist: [...key.modelWhitelist],
        ipRestrictionEnabled: key.ipRestrictionEnabled,
        ipWhitelist: parseLines(key.ipWhitelistText),
        ipBlacklist: parseLines(key.ipBlacklistText),
        quota: key.quota,
        rateLimit: key.rateLimit,
        expiresAt: key.expirationEnabled ? fromDateTimeLocal(key.expiresAt) : null,
    };
}

function validateKeys(): void {
    const values = new Set<string>();
    for (const key of formState.keys) {
        if (!key.name.trim()) {
            throw new Error('Key 名称不能为空');
        }
        if (!key.value.trim()) {
            throw new Error('Key 值不能为空');
        }
        const value = key.value.trim();
        if (values.has(value)) {
            throw new Error('Key 不能重复');
        }
        values.add(value);
        if (key.modelWhitelistEnabled && key.modelWhitelist.length === 0) {
            throw new Error(`Key“${key.name}”至少需要选择一个模型`);
        }
        if (!Number.isFinite(key.quota) || key.quota < 0) {
            throw new Error('额度限制必须是非负数');
        }
        if (!Number.isSafeInteger(key.rateLimit) || key.rateLimit < 0) {
            throw new Error('速率限制必须是非负整数');
        }
        if (key.expirationEnabled) {
            // 开启有效期时必须填写可解析的日期；否则空值会被静默保存为“永不过期”。
            fromDateTimeLocal(key.expiresAt);
        }
    }
}

async function handleOk(): Promise<void> {
    if (userId.value === null) {
        notifyError('用户 ID 无效');
        return;
    }

    let payload: UserKeyInput[];
    try {
        validateKeys();
        payload = formState.keys.map(toPayload);
    } catch (error) {
        notifyRequestError(error, 'Key 表单校验失败');
        return;
    }

    saving.value = true;
    try {
        const updated = await userStore.updateKeys(userId.value, payload);
        if (!updated) {
            notifyError('用户不存在');
            return;
        }
        notifySuccess('Key 已更新');
        emit('success', updated);
        handleCancel();
    } catch (error) {
        notifyRequestError(error, 'Key 更新失败');
    } finally {
        saving.value = false;
    }
}

function handleCancel(): void {
    visible.value = false;
    user.value = null;
    userId.value = null;
    formState.keys = [];
    activeKeys.value = [];
}

defineExpose({ open });
</script>

<style scoped>
.user-hint {
    margin-bottom: 16px;
}

.keys-form {
    max-height: 65vh;
    overflow-y: auto;
    padding-right: 4px;
}

.key-panel-header {
    display: flex;
    align-items: center;
    gap: 10px;
}

.key-panel-title {
    overflow: hidden;
    color: var(--text-primary);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.key-card {
    background: var(--component-bg, #fff);
}

.switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    color: var(--text-secondary);
}

.expiration-toggle {
    margin-bottom: 12px;
}

.field-hint {
    margin-top: 6px;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.5;
}

.monospace :deep(textarea),
.monospace {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.expiration-input {
    max-width: 280px;
}

.add-key-button {
    margin-top: 16px;
}

@media (max-width: 640px) {
    .switch-row {
        align-items: flex-start;
    }
}
</style>
