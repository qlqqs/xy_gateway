import { describe, expect, it } from 'vitest';
import type { Vendor } from '@/types/vendor';
import vendorProtocol from './vendorProtocol';

function makeVendor(overrides: Partial<Vendor> = {}): Vendor {
    return {
        id: 1,
        type: 'other',
        name: 'Test vendor',
        token: 'token',
        urls: {},
        config: {},
        model_count: 0,
        created_at: new Date(0),
        updated_at: new Date(0),
        ...overrides,
    };
}

describe('vendorProtocol', () => {
    it('优先使用显式供应商协议声明', () => {
        const vendor = makeVendor({
            urls: { anthropic: 'https://example.test/v1/messages' },
            config: { api_type: 'openai', openai_protocol: 'responses' },
        });

        expect(vendorProtocol.resolveApiType(vendor)).toBe('openai');
        expect(vendorProtocol.resolveRequestFormat(vendor)).toBe('responses');
    });

    it('从旧供应商的唯一 URL 推断 Anthropic 或 Responses 协议', () => {
        const anthropic = makeVendor({ urls: { anthropic: 'https://example.test/v1/messages' } });
        const responses = makeVendor({ urls: { responses: 'https://example.test/v1/responses' } });

        expect(vendorProtocol.resolveRequestFormat(anthropic)).toBe('anthropic');
        expect(vendorProtocol.resolveRequestFormat(responses)).toBe('responses');
    });

    it('缺少显式声明和 URL 时按供应商类型兼容旧数据', () => {
        expect(vendorProtocol.resolveRequestFormat(makeVendor({ type: 'anthropic' }))).toBe('anthropic');
        expect(vendorProtocol.resolveRequestFormat(makeVendor({ type: 'openrouter' }))).toBe('openai');
    });
});
