import { computed } from 'vue';
import { VENDOR_PRESETS, type VendorPreset } from '@/constants/vendor';
import type { VendorType } from '@/types/vendor';

type PresetUrls = Record<VendorType, VendorPreset>;

const presetUrls: PresetUrls = VENDOR_PRESETS;

export function useVendorPresets() {
    const vendorTypeOptions = computed(() => Object.entries(presetUrls).map(([value, preset]) => ({
        value,
        label: preset.label,
    })));

    return { presetUrls, vendorTypeOptions };
}
