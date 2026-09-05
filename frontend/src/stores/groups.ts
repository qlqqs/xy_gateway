import { ref } from 'vue';

export type GroupStatus = 'active' | 'disabled';
export type InboundProtocol = 'openai_chat' | 'openai_responses' | 'anthropic';

export interface GroupRecord {
    id: number;
    name: string;
    description: string;
    inboundProtocols: InboundProtocol[];
    channelCount: number;
    customModels: string[];
    whitelistEnabled: boolean;
    rateMultiplier: number;
    status: GroupStatus;
    updatedAt: string;
}

const groups = ref<GroupRecord[]>([
    {
        id: 1,
        name: '默认分组',
        description: '系统默认访问范围',
        inboundProtocols: ['openai_responses'],
        channelCount: 0,
        customModels: [],
        whitelistEnabled: false,
        rateMultiplier: 1,
        status: 'active',
        updatedAt: '—',
    },
]);

export default { groups };
