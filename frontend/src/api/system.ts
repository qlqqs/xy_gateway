import request from '@/utils/request';
import type { StatusResponse, UpdateStatusResponse } from '@/types/system';

export function status(): Promise<StatusResponse> {
    return request.get('/status.json');
}

export function checkUpdate(force: boolean = false): Promise<UpdateStatusResponse> {
    return request.get(`/update.json${force ? '?force=1' : ''}`);
}
