import type { OpenAiProtocol, Vendor, VendorApiType } from '@/types/vendor';

type VendorRequestFormat = 'openai' | 'anthropic' | 'responses';


function hasUrl(vendor: Vendor, key: string): boolean {
    return typeof vendor.urls?.[key] === 'string' && !!vendor.urls[key]?.trim();
}


function resolveApiType(vendor: Vendor): VendorApiType {
    if (vendor.config?.api_type === 'openai' || vendor.config?.api_type === 'anthropic') {
        return vendor.config.api_type;
    }
    if (vendor.type === 'anthropic') return 'anthropic';

    const hasAnthropic = hasUrl(vendor, 'anthropic');
    const hasOpenAi = hasUrl(vendor, 'openai') || hasUrl(vendor, 'responses');
    return hasAnthropic && !hasOpenAi ? 'anthropic' : 'openai';
}


function resolveOpenAiProtocol(vendor: Vendor, apiType = resolveApiType(vendor)): OpenAiProtocol {
    if (vendor.config?.openai_protocol === 'chat_completions'
        || vendor.config?.openai_protocol === 'responses') {
        return vendor.config.openai_protocol;
    }
    if (apiType === 'openai' && hasUrl(vendor, 'responses') && !hasUrl(vendor, 'openai')) {
        return 'responses';
    }
    return 'chat_completions';
}


function resolveRequestFormat(vendor: Vendor): VendorRequestFormat {
    const apiType = resolveApiType(vendor);
    if (apiType === 'anthropic') return 'anthropic';
    return resolveOpenAiProtocol(vendor, apiType) === 'responses' ? 'responses' : 'openai';
}


export default {
    resolveApiType,
    resolveOpenAiProtocol,
    resolveRequestFormat,
};
