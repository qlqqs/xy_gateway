import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import type { RecordDetail } from '@/types/record';

const mocks = vi.hoisted(() => ({
    recordStore: {
        loading: false,
        currentRecord: null as RecordDetail | null,
        activities: [],
        fetchRecordDetail: vi.fn(),
        clearCurrentRecord: vi.fn(),
    },
    routerPush: vi.fn(),
    deleteRecord: vi.fn(),
    downloadJson: vi.fn(),
    messageSuccess: vi.fn(),
    messageError: vi.fn(),
    messageWarning: vi.fn(),
}));

vi.mock('@/stores/record', () => ({
    useRecordStore: () => mocks.recordStore,
}));
vi.mock('vue-router', () => ({
    useRouter: () => ({ push: mocks.routerPush }),
    useRoute: () => ({ params: { id: '1' } }),
}));
vi.mock('@/api/record', () => ({
    deleteRecord: mocks.deleteRecord,
}));
vi.mock('@/utils/format', () => ({
    formatDate: () => '2026-09-08 00:00:00',
}));
vi.mock('@/utils/jsonDownload', () => ({
    default: { downloadJson: mocks.downloadJson },
}));
vi.mock('ant-design-vue/es', () => ({
    message: {
        success: mocks.messageSuccess,
        error: mocks.messageError,
        warning: mocks.messageWarning,
    },
}));

import RecordDetailView from './Detail.vue';

enableAutoUnmount(afterEach);

/* eslint-disable vue/one-component-per-file -- test-only Ant Design stubs. */
const PassthroughStub = defineComponent({
    inheritAttrs: false,
    template: '<div v-bind="$attrs"><slot /></div>',
});

const DescriptionsItemStub = defineComponent({
    inheritAttrs: false,
    props: {
        label: { type: String, default: '' },
    },
    template: '<section v-bind="$attrs"><span class="description-label">{{ label }}</span><slot /></section>',
});

const TagStub = defineComponent({
    inheritAttrs: false,
    props: {
        color: { type: String, default: '' },
    },
    template: '<span v-bind="$attrs" :data-color="color"><slot /></span>',
});
/* eslint-enable vue/one-component-per-file */

const global = {
    components: {
        APageHeader: PassthroughStub,
        ASpace: PassthroughStub,
        AButton: PassthroughStub,
        APopconfirm: PassthroughStub,
        ASpin: PassthroughStub,
        ACard: PassthroughStub,
        ADescriptions: PassthroughStub,
        ADescriptionsItem: DescriptionsItemStub,
        ATag: TagStub,
        AEmpty: PassthroughStub,
        ATabs: PassthroughStub,
        ATabPane: PassthroughStub,
    },
    stubs: {
        JsonViewer: true,
        ActivityTimeline: true,
        DownloadOutlined: true,
        ArrowUpOutlined: true,
        ArrowDownOutlined: true,
    },
};

function buildRecord(overrides: Partial<RecordDetail> = {}): RecordDetail {
    return {
        id: 1,
        created_at: new Date('2026-09-08T00:00:00Z'),
        updated_at: new Date('2026-09-08T00:00:00Z'),
        user_id: 1,
        key_id: 2,
        group_id: 3,
        model_id: 4,
        requested_model: 'gateway-model',
        request_data: null,
        response_data: null,
        status: 'success',
        failed_code: null,
        client_format: 'openai',
        upstream_format: 'openai',
        usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            cache_read_tokens: 0,
            cost_breakdown: {
                input_cost: 0.4,
                image_input_cost: 0,
                output_cost: 0.6,
                image_output_cost: 0,
                cache_creation_cost: 0,
                cache_creation_5m_cost: 0,
                cache_creation_1h_cost: 0,
                cache_read_cost: 0,
                request_cost: 0,
                total_cost: 1,
            },
        },
        first_token_latency: 10,
        start_at: '2026-09-08T00:00:00Z',
        end_at: '2026-09-08T00:00:01Z',
        billing_mode: 'token',
        base_cost: 1,
        rate_multiplier: 2,
        cost: 2,
        settlement_status: 'settled',
        user_name: '测试用户',
        vendor_id: 5,
        vendor_name: '测试供应商',
        model_name: 'gateway-model',
        vendor_model_name: 'upstream-model',
        ...overrides,
    };
}

function mountDetail(record: RecordDetail) {
    mocks.recordStore.currentRecord = record;
    return mount(RecordDetailView, { global });
}

describe('Record/Detail billing summary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.recordStore.currentRecord = null;
        mocks.recordStore.fetchRecordDetail.mockResolvedValue(undefined);
    });

    it('区分模型原价、倍率与 settled 的最终实扣', async () => {
        const wrapper = mountDetail(buildRecord());
        await flushPromises();

        expect(wrapper.get('.model-base-cost').text()).toBe('模型原价小计 ¥1.000000');
        expect(wrapper.get('.rate-multiplier').text()).toBe('计费倍率 ×2');
        expect(wrapper.get('.actual-cost').text()).toBe('实际扣费 ¥2.000000');
        expect(wrapper.get('.settlement-status').text()).toBe('已结算');
        expect(wrapper.text()).not.toContain('合计 ¥1.000000');
    });

    it('skipped 明确显示零实扣和未扣费', async () => {
        const wrapper = mountDetail(buildRecord({
            cost: 0,
            settlement_status: 'skipped',
        }));
        await flushPromises();

        expect(wrapper.get('.actual-cost').text()).toBe('实际扣费 ¥0.000000');
        expect(wrapper.get('.settlement-status').text()).toBe('已跳过结算（未扣费）');
    });

    it('实际扣费保留微元精度，不将微小正金额显示为零', async () => {
        const wrapper = mountDetail(buildRecord({
            usage: null,
            base_cost: 0.000001,
            rate_multiplier: 1,
            cost: 0.000001,
        }));
        await flushPromises();

        expect(wrapper.get('.model-base-cost').text()).toBe('模型原价小计 ¥0.000001');
        expect(wrapper.get('.actual-cost').text()).toBe('实际扣费 ¥0.000001');
        expect(wrapper.get('.settlement-status').text()).toBe('已结算');
    });

    it('usage 为 null 时仍从记录快照展示完整结算汇总', async () => {
        const wrapper = mountDetail(buildRecord({ usage: null }));
        await flushPromises();

        expect(wrapper.get('.model-base-cost').text()).toBe('模型原价小计 ¥1.000000');
        expect(wrapper.get('.rate-multiplier').text()).toBe('计费倍率 ×2');
        expect(wrapper.get('.actual-cost').text()).toBe('实际扣费 ¥2.000000');
        expect(wrapper.get('.settlement-status').text()).toBe('已结算');
        expect(wrapper.get('.cost-breakdown').text()).not.toContain('文本输入');
    });

    it('pending 不把零值显示成已经实扣', async () => {
        const wrapper = mountDetail(buildRecord({
            usage: null,
            cost: 0,
            settlement_status: 'pending',
        }));
        await flushPromises();

        expect(wrapper.get('.model-base-cost').text()).toBe('模型原价小计 ¥1.000000');
        expect(wrapper.get('.actual-cost').text()).toBe('实际扣费 尚未结算');
        expect(wrapper.get('.settlement-status').text()).toBe('待结算（尚未扣费）');
    });

    it('settled 零费用明确标识为零费用', async () => {
        const wrapper = mountDetail(buildRecord({
            usage: null,
            base_cost: 0,
            rate_multiplier: 1,
            cost: 0,
        }));
        await flushPromises();

        expect(wrapper.get('.actual-cost').text()).toBe('实际扣费 ¥0.000000');
        expect(wrapper.get('.settlement-status').text()).toBe('已结算（零费用）');
    });
});
