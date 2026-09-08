<template>
    <div class="record-detail">
        <a-page-header
            title="请求记录详情"
            @back="handleBack"
        >
            <template #extra>
                <a-space>
                    <a-button
                        :disabled="currentRecordId <= 1"
                        @click="navigateToRecord(currentRecordId - 1)"
                    >
                        上一个请求
                    </a-button>
                    <a-button
                        :disabled="currentRecordId <= 0"
                        @click="navigateToRecord(currentRecordId + 1)"
                    >
                        下一个请求
                    </a-button>
                    <a-popconfirm
                        title="确认删除这条请求记录？"
                        ok-text="删除"
                        cancel-text="取消"
                        ok-type="danger"
                        @confirm="handleDelete"
                    >
                        <a-button danger>
                            删除
                        </a-button>
                    </a-popconfirm>
                </a-space>
            </template>
        </a-page-header>

        <a-spin :spinning="recordStore.loading">
            <div v-if="recordStore.currentRecord" class="detail-content">
                <!-- 基本信息 -->
                <a-card title="基本信息" class="detail-card">
                    <a-descriptions :column="2" bordered>
                        <a-descriptions-item label="请求 ID">
                            {{ recordStore.currentRecord.id }}
                        </a-descriptions-item>
                        <a-descriptions-item label="状态">
                            <a-tag :color="getStatusColor(recordStore.currentRecord.status)">
                                {{ getStatusText(recordStore.currentRecord.status) }}
                            </a-tag>
                        </a-descriptions-item>
                        <a-descriptions-item label="用户">
                            {{ recordStore.currentRecord.user_name || '-' }}
                        </a-descriptions-item>
                        <a-descriptions-item label="模型">
                            {{ recordStore.currentRecord.model_name || '-' }}
                        </a-descriptions-item>
                        <a-descriptions-item label="供应商">
                            {{ recordStore.currentRecord.vendor_name || '-' }}
                        </a-descriptions-item>
                        <a-descriptions-item label="供应商模型">
                            {{ recordStore.currentRecord.vendor_model_name || '-' }}
                        </a-descriptions-item>
                        <a-descriptions-item label="协议">
                            <div v-if="recordStore.currentRecord.client_format" class="protocol-row">
                                <a-tag>{{ recordStore.currentRecord.client_format.toUpperCase() }}</a-tag>
                                <template v-if="recordStore.currentRecord.upstream_format">
                                    <span class="protocol-arrow">→</span>
                                    <a-tag color="orange">{{ recordStore.currentRecord.upstream_format.toUpperCase() }}</a-tag>
                                </template>
                            </div>
                            <span v-else>-</span>
                        </a-descriptions-item>
                        <a-descriptions-item label="创建时间">
                            {{ formatDate(recordStore.currentRecord.created_at) }}
                        </a-descriptions-item>
                        <a-descriptions-item label="Token">
                            <div v-if="usageTokens" class="token-row">
                                <span class="token-item" title="输入 Token">
                                    <ArrowUpOutlined class="token-icon input" />
                                    {{ usageTokens.prompt.toLocaleString() }}
                                </span>
                                <span class="token-divider">/</span>
                                <span class="token-item" title="输出 Token">
                                    <ArrowDownOutlined class="token-icon output" />
                                    {{ usageTokens.output }}
                                </span>
                            </div>
                            <span v-else>-</span>
                        </a-descriptions-item>
                        <a-descriptions-item label="缓存命中">
                            <template v-if="usageTokens?.cacheReadTokens != null">
                                {{ usageTokens.cacheReadTokens.toLocaleString() }}
                                ({{ usageTokens.cacheHitRate!.toFixed(1) }}%)
                            </template>
                            <span v-else>-</span>
                        </a-descriptions-item>
                        <a-descriptions-item label="缓存创建">
                            <template v-if="usageTokens?.cacheCreationTokens != null">
                                {{ usageTokens.cacheCreationTokens.toLocaleString() }}
                                <span v-if="usageTokens.cacheCreation5mTokens != null || usageTokens.cacheCreation1hTokens != null" class="usage-detail">
                                    5m {{ (usageTokens.cacheCreation5mTokens ?? 0).toLocaleString() }} /
                                    1h {{ (usageTokens.cacheCreation1hTokens ?? 0).toLocaleString() }}
                                </span>
                            </template>
                            <span v-else>-</span>
                        </a-descriptions-item>
                        <a-descriptions-item label="图片 Token">
                            <template v-if="usageTokens?.imageInputTokens != null || usageTokens?.imageOutputTokens != null">
                                输入 {{ (usageTokens?.imageInputTokens ?? 0).toLocaleString() }} /
                                输出 {{ (usageTokens?.imageOutputTokens ?? 0).toLocaleString() }}
                            </template>
                            <span v-else>-</span>
                        </a-descriptions-item>
                        <a-descriptions-item v-if="billingSummary" label="费用明细" :span="2">
                            <div class="cost-breakdown">
                                <template v-if="costBreakdown">
                                    <span>文本输入 {{ formatCost(costBreakdown.input_cost) }}</span>
                                    <span v-if="costBreakdown.image_input_cost">图片输入 {{ formatCost(costBreakdown.image_input_cost) }}</span>
                                    <span>文本输出 {{ formatCost(costBreakdown.output_cost) }}</span>
                                    <span v-if="costBreakdown.image_output_cost">图片输出 {{ formatCost(costBreakdown.image_output_cost) }}</span>
                                    <template v-if="costBreakdown.cache_creation_5m_cost || costBreakdown.cache_creation_1h_cost">
                                        <span v-if="costBreakdown.cache_creation_5m_cost">缓存创建 5m {{ formatCost(costBreakdown.cache_creation_5m_cost) }}</span>
                                        <span v-if="costBreakdown.cache_creation_1h_cost">缓存创建 1h {{ formatCost(costBreakdown.cache_creation_1h_cost) }}</span>
                                    </template>
                                    <span v-else-if="costBreakdown.cache_creation_cost">缓存创建 {{ formatCost(costBreakdown.cache_creation_cost) }}</span>
                                    <span v-if="costBreakdown.cache_read_cost">缓存读取 {{ formatCost(costBreakdown.cache_read_cost) }}</span>
                                    <span v-if="costBreakdown.request_cost">按次 {{ formatCost(costBreakdown.request_cost) }}</span>
                                </template>
                                <strong class="model-base-cost">模型原价小计 {{ formatCost(billingSummary.baseCost) }}</strong>
                                <span class="rate-multiplier">计费倍率 ×{{ formatMultiplier(billingSummary.rateMultiplier) }}</span>
                                <strong class="actual-cost">实际扣费 {{ billingSummary.actualCostText }}</strong>
                                <a-tag class="settlement-status" :color="billingSummary.statusColor">
                                    {{ billingSummary.statusText }}
                                </a-tag>
                            </div>
                        </a-descriptions-item>
                        <a-descriptions-item label="总耗时">
                            {{ totalDuration !== null ? totalDuration.toLocaleString() + 'ms' : '-' }}
                        </a-descriptions-item>
                        <a-descriptions-item label="首 Token 延迟">
                            {{ recordStore.currentRecord.first_token_latency !== null ? recordStore.currentRecord.first_token_latency + 'ms' : '-' }}
                        </a-descriptions-item>
                    </a-descriptions>
                </a-card>

                <!-- 请求与响应数据 -->
                <a-card class="detail-card request-tabs-card">
                    <a-tabs v-model:active-key="activeRequestTab">
                        <template #rightExtra>
                            <a-space v-if="activeRequestTab === 'request_json'">
                                <a-button type="link" size="small" @click="isRequestExpanded = !isRequestExpanded">
                                    {{ isRequestExpanded ? '收起' : '展开' }}
                                </a-button>
                                <a-button type="link" size="small" @click="requestJsonRef?.handleCopy()">
                                    复制
                                </a-button>
                                <a-button
                                    type="link"
                                    size="small"
                                    :disabled="!recordStore.currentRecord?.request_data"
                                    @click="downloadJson(recordStore.currentRecord?.request_data, 'request')"
                                >
                                    <template #icon><DownloadOutlined /></template>
                                    下载
                                </a-button>
                            </a-space>
                            <a-space v-else-if="activeRequestTab === 'response_json'">
                                <a-button type="link" size="small" @click="isResponseExpanded = !isResponseExpanded">
                                    {{ isResponseExpanded ? '收起' : '展开' }}
                                </a-button>
                                <a-button type="link" size="small" @click="responseJsonRef?.handleCopy()">
                                    复制
                                </a-button>
                                <a-button
                                    type="link"
                                    size="small"
                                    :disabled="!recordStore.currentRecord?.response_data"
                                    @click="downloadJson(recordStore.currentRecord?.response_data, 'response')"
                                >
                                    <template #icon><DownloadOutlined /></template>
                                    下载
                                </a-button>
                            </a-space>
                        </template>

                        <a-tab-pane key="visual" tab="可视化对话" v-if="Array.isArray(conversationData) ? conversationData.length > 0 : conversationData.messages.length > 0">
                            <div class="visualization-container">
                                <iframe 
                                    ref="viewerIframe" 
                                    src="/data_viewer/dist/index.html" 
                                    @load="onIframeLoad" 
                                    frameborder="0"
                                    class="visualization-iframe"
                                />
                            </div>
                        </a-tab-pane>

                        <a-tab-pane key="request_json" tab="请求数据 (JSON)">
                            <div class="json-pane-content">
                                <div v-if="!recordStore.currentRecord.request_data" class="no-payload-hint">
                                    <div class="no-payload-title">请求内容未记录</div>
                                    <div class="no-payload-desc">如需记录请到设置中打开开关</div>
                                </div>
                                <JsonViewer v-else ref="requestJsonRef" :data="recordStore.currentRecord.request_data" :expanded="isRequestExpanded" />
                            </div>
                        </a-tab-pane>

                        <a-tab-pane key="response_json" tab="响应数据 (JSON)">
                            <div class="json-pane-content">
                                <div v-if="!recordStore.currentRecord.response_data" class="no-payload-hint">
                                    <div class="no-payload-title">响应内容未记录</div>
                                    <div class="no-payload-desc">如需记录请到设置中打开开关</div>
                                </div>
                                <JsonViewer v-else ref="responseJsonRef" :data="recordStore.currentRecord.response_data" :expanded="isResponseExpanded" />
                            </div>
                        </a-tab-pane>

                        <a-tab-pane key="activity" tab="日志">
                            <ActivityTimeline :activities="recordStore.activities" />
                        </a-tab-pane>

                        <a-tab-pane v-if="recordStore.currentRecord.status === 'failed'" key="error" tab="报错信息">
                            <div class="error-pane-content">
                                <div v-if="recordStore.currentRecord.failed_code" class="error-type">
                                    {{ FAILED_CODE_LABELS[recordStore.currentRecord.failed_code] ?? recordStore.currentRecord.failed_code }}
                                </div>
                                <div class="error-message-text">{{ getErrorMessage(recordStore.currentRecord.response_data) }}</div>
                            </div>
                        </a-tab-pane>
                    </a-tabs>
                </a-card>
            </div>

            <a-empty v-else description="请求未找到" />
        </a-spin>
    </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, watch, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { DownloadOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons-vue';
import { useRecordStore } from '@/stores/record';
import { deleteRecord } from '@/api/record';
import { formatDate } from '@/utils/format';
import JsonDownload from '@/utils/jsonDownload';
import JsonViewer from '@/components/common/JsonViewer.vue';
import ActivityTimeline from '@/components/common/ActivityTimeline.vue';
import { FAILED_CODE_LABELS } from '@/constants/record';
import { message } from 'ant-design-vue/es';

const router = useRouter();
const route = useRoute();
const recordStore = useRecordStore();

const viewerIframe = ref<HTMLIFrameElement | null>(null);
const activeRequestTab = ref<string>('request_json');

interface JsonViewerHandle {
    handleCopy: () => void;
}

interface ViewerBridge {
    setLlmData?: (data: ConversationData) => void;
}

interface ViewerWindow extends Window {
    gt_bridge?: ViewerBridge;
}

interface ConversationObject {
    system?: unknown;
    messages: unknown[];
}

type ConversationData = unknown[] | ConversationObject;

const requestJsonRef = ref<JsonViewerHandle | null>(null);
const responseJsonRef = ref<JsonViewerHandle | null>(null);

const isRequestExpanded = ref(true);
const isResponseExpanded = ref(true);

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

const conversationData = computed(() => {
    const messages: unknown[] = [];
    let system: unknown;
    try {
        if (recordStore.currentRecord?.request_data) {
            const req: unknown = JSON.parse(recordStore.currentRecord.request_data);
            if (isRecord(req) && Array.isArray(req.messages)) {
                messages.push(...req.messages);
            }
            if (isRecord(req) && req.system != null) {
                system = req.system;
            }
        }
    } catch {
        // 请求内容可能不是 JSON，保留原始详情页继续展示。
    }
    try {
        if (recordStore.currentRecord?.response_data) {
            const res: unknown = JSON.parse(recordStore.currentRecord.response_data);
            if (isRecord(res) && Array.isArray(res.choices)
                && isRecord(res.choices[0]) && res.choices[0].message) {
                messages.push(res.choices[0].message);
            } else if (isRecord(res) && res.message) {
                messages.push(res.message);
            }
        }
    } catch {
        // 响应内容可能不是 JSON，保留原始详情页继续展示。
    }
    return system !== undefined ? { system, messages } : messages;
});

function getMessageCount(data: ConversationData): number {
    if (Array.isArray(data)) return data.length;
    return data.messages.length;
}

function sendConversationToViewer(data: ConversationData): void {
    const frameWindow = viewerIframe.value?.contentWindow as ViewerWindow | null;
    frameWindow?.gt_bridge?.setLlmData?.(data);
}

function onIframeLoad() {
    if (viewerIframe.value?.contentWindow) {
        setTimeout(() => {
            sendConversationToViewer(conversationData.value);
        }, 300);
    }
}

watch(conversationData, (newVal) => {
    if (getMessageCount(newVal) > 0) {
        activeRequestTab.value = 'visual';
    } else if (recordStore.currentRecord?.status === 'failed') {
        activeRequestTab.value = 'error';
    } else {
        activeRequestTab.value = 'request_json';
    }

    if (getMessageCount(newVal) > 0 && viewerIframe.value && viewerIframe.value.contentWindow) {
        sendConversationToViewer(newVal);
    }
}, { deep: true, immediate: true });

const usageTokens = computed(() => {
    const usage = recordStore.currentRecord?.usage;
    if (!usage) return null;
    const u = usage;
    if (u.prompt_tokens == null && u.completion_tokens == null) return null;
    const prompt: number = u.prompt_tokens ?? 0;
    const output: number = u.completion_tokens ?? 0;
    const cacheRead = u.cache_read_tokens;
    const cacheCreation = u.cache_creation_tokens ?? null;
    let cacheHitRate: number | null = null;
    if (cacheRead != null) {
        const total = prompt + cacheRead + (cacheCreation ?? 0);
        cacheHitRate = total > 0 ? Math.floor(cacheRead / total * 1000) / 10 : 0;
    }
    return {
        prompt,
        output,
        cacheHitRate,
        cacheReadTokens: cacheRead ?? null,
        cacheCreationTokens: cacheCreation,
        cacheCreation5mTokens: u.cache_creation_5m_tokens ?? null,
        cacheCreation1hTokens: u.cache_creation_1h_tokens ?? null,
        imageInputTokens: u.image_input_tokens ?? null,
        imageOutputTokens: u.image_output_tokens ?? null,
    };
});

const costBreakdown = computed(() => recordStore.currentRecord?.usage?.cost_breakdown ?? null);

const billingSummary = computed(() => {
    const record = recordStore.currentRecord;
    if (!record) return null;

    const baseCost = costBreakdown.value?.total_cost ?? record.base_cost;
    const rateMultiplier = record.rate_multiplier;

    switch (record.settlement_status) {
        case 'settled':
            return {
                baseCost,
                rateMultiplier,
                actualCostText: formatCost(record.cost),
                statusText: record.cost === 0 ? '已结算（零费用）' : '已结算',
                statusColor: 'success',
            };
        case 'skipped':
            return {
                baseCost,
                rateMultiplier,
                actualCostText: formatCost(record.cost),
                statusText: '已跳过结算（未扣费）',
                statusColor: 'default',
            };
        case 'pending':
        default:
            return {
                baseCost,
                rateMultiplier,
                actualCostText: '尚未结算',
                statusText: '待结算（尚未扣费）',
                statusColor: 'processing',
            };
    }
});

function formatCost(value: number): string {
    return `¥${value.toFixed(6)}`;
}

function formatMultiplier(value: number): string {
    return Number.isFinite(value) ? String(value) : '-';
}

const totalDuration = computed(() => {
    const r = recordStore.currentRecord;
    if (!r?.start_at || !r?.end_at) return null;
    const start = new Date(r.start_at).getTime();
    const end = new Date(r.end_at).getTime();
    if (isNaN(start) || isNaN(end)) return null;
    return end - start;
});

const currentRecordId = computed<number>(() => {
    const id = Number.parseInt(route.params.id as string, 10);
    return Number.isNaN(id) ? 0 : id;
});

watch(
    () => route.params.id,
    (idValue) => {
        const id = Number.parseInt(idValue as string, 10);
        if (Number.isNaN(id)) {
            recordStore.clearCurrentRecord();
            return;
        }

        void recordStore.fetchRecordDetail(id);
    },
    { immediate: true }
);

function navigateToRecord(targetId: number) {
    if (targetId <= 0) {
        return;
    }

    void router.push({
        name: 'RecordDetail',
        params: { id: String(targetId) },
    });
}

function handleBack() {
    void router.push({ name: 'RecordList' });
}

async function handleDelete() {
    if (!recordStore.currentRecord) return;
    try {
        await deleteRecord(recordStore.currentRecord.id);
        message.success('删除成功');
        void router.push({ name: 'RecordList' });
    } catch {
        message.error('删除失败');
    }
}

onUnmounted(() => {
    recordStore.clearCurrentRecord();
});

function getStatusColor(status: string | null): string {
    switch (status) {
        case 'success':
            return 'success';
        case 'failed':
            return 'error';
        case 'processing':
            return 'processing';
        case 'init':
        default:
            return 'default';
    }
}

function getStatusText(status: string | null): string {
    switch (status) {
        case 'success':
            return '成功';
        case 'failed':
            return '失败';
        case 'processing':
            return '处理中';
        case 'init':
            return '初始化';
        default:
            return '未知';
    }
}

function getErrorMessage(responseData: string | null): string {
    if (!responseData) return '未知错误';
    try {
        const parsed = JSON.parse(responseData);
        return parsed.error?.message || parsed.error || '请求失败';
    } catch {
        return responseData || '请求失败';
    }
}


async function downloadJson(data: string | null, type: 'request' | 'response') {
    if (!data) {
        message.warning('没有数据可下载');
        return;
    }

    try {
        const recordId = recordStore.currentRecord?.id || 'unknown';
        const timestamp = formatDate(new Date()).replace(/[:\s]/g, '-');
        const filename = `record-${recordId}-${type}-${timestamp}.json`;
        const downloaded = await JsonDownload.downloadJson(data, filename);

        if (downloaded) {
            message.success('下载成功');
        }
    } catch (error) {
        if (error instanceof SyntaxError) {
            message.error('下载失败：数据格式错误');
        } else {
            message.error('下载失败');
        }
    }
}
</script>

<style scoped>
.record-detail {
    background: var(--bg-page);
    min-height: 100%;
}

.detail-content {
    padding: 0 24px 24px;
}

.detail-card {
    margin-top: 16px;
}

.detail-card:first-child {
    margin-top: 0;
}

.error-pane-content {
    padding: 8px 0;
}

.error-type {
    color: #8c8c8c;
    font-size: 13px;
    margin-bottom: 6px;
}

.error-message-text {
    color: #ff4d4f;
}

.no-payload-hint {
    padding: 32px 0;
    text-align: center;
}

.no-payload-title {
    font-size: 16px;
    font-weight: 500;
    color: var(--text-primary, #333);
    margin-bottom: 8px;
}

.no-payload-desc {
    font-size: 13px;
    color: var(--text-secondary, #999);
}

.token-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

.token-icon {
    font-size: 14px;
}

.token-icon.input {
    color: var(--accent-primary);
}

.token-icon.output {
    color: #52c41a;
}

.token-row {
    display: flex;
    align-items: center;
}

.token-divider {
    margin: 0 6px;
    color: #d9d9d9;
    line-height: 1;
}

.usage-detail {
    margin-left: 8px;
    color: var(--text-secondary, #8c8c8c);
    white-space: nowrap;
}

.cost-breakdown {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    font-variant-numeric: tabular-nums;
}

.protocol-row {
    display: flex;
    align-items: center;
    gap: 4px;
}

.protocol-row :deep(.ant-tag) {
    display: inline-flex;
    align-items: center;
    margin: 0;
}

.protocol-arrow {
    color: #8c8c8c;
    font-size: 12px;
    line-height: 1;
}

.visualization-container {
    height: 700px;
    width: 100%;
}

.visualization-iframe {
    width: 100%;
    height: 100%;
    border: 1px solid var(--border-color, #f0f0f0);
    border-radius: 8px;
}

.request-tabs-card :deep(.ant-card-body) {
    padding-top: 0;
}

.request-tabs-card :deep(.ant-tabs-nav) {
    margin-bottom: 16px;
}

.json-pane-content {
    margin-top: 8px;
}
</style>
