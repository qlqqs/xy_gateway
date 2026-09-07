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
    /** 后端按供应商关联实时统计的通道数量。 */
    channelCount?: number;
}

export type GroupDraft = Omit<GroupRecord, 'id' | 'updatedAt' | 'channelCount'>;
