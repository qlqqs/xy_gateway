export interface SystemStatusInfo {
    environment?: string;
    version?: string;
    apiAddress?: string;
    startTime?: string;
    uptime?: string;
    /** Node 进程的 RSS 内存占用（如 "128.5 MB"）。 */
    memory?: string | null;
}

export interface SystemStatistics {
    users?: number;
    vendors?: number;
    models?: number;
    records?: number;
}

export interface StatusResponse {
    status?: string;
    user_type?: string;
    system?: SystemStatusInfo;
    statistics?: SystemStatistics;
    modules?: {
        billing?: boolean;
    };
    timestamp?: string;
}

export interface UpdateStatusResponse {
    success: boolean;
    has_update: boolean;
    current_version: string;
    latest_version: string;
    release_url?: string;
    release_notes?: string;
    error_message?: string;
}
