export type GroupStatus = 'active' | 'disabled';

export type InboundProtocol = 'openai_chat' | 'openai_responses' | 'anthropic';

export interface GroupRecord {
    id: number;
    name: string;
    description: string;
    inboundProtocols: InboundProtocol[];
    customModels: string[];
    whitelistEnabled: boolean;
    rateMultiplier: number;
    status: GroupStatus;
    updatedAt: string;
}

export type GroupDraft = Omit<GroupRecord, 'id' | 'updatedAt'>;
