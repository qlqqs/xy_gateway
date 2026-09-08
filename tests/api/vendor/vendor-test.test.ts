import { describe, it, expect, beforeAll } from 'vitest';
import requestHelper from '../../helpers/requestHelper';
import dbHelper from '../../helpers/dbHelper';

describe('Vendor Test API', () => {
    let rootToken = 'root-token-123';

    beforeAll(async () => {
        await dbHelper.truncate();
    });

    it('should test vendor connectivity (OpenAI format)', async () => {
        // Create a vendor pointing to our mock server
        const vendor = await requestHelper.post('/vendor/create.json', {
            type: 'other',
            name: 'Test Vendor',
            token: 'test-token',
            urls: {
                openai: 'http://localhost:9999/v1/chat/completions'
            }
        }, rootToken);

        const response = await requestHelper.post(`/vendor/${vendor.body.id}/test.json`, {
            format: 'openai',
            model: 'gpt-4'
        }, rootToken);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body).toHaveProperty('duration');
        expect(response.body).toHaveProperty('status', 200);
    });

    it('should test vendor connectivity with custom model', async () => {
        const vendor = await requestHelper.post('/vendor/create.json', {
            type: 'other',
            name: 'Custom Model Vendor',
            token: 'test-token',
            urls: {
                openai: 'http://localhost:9999/v1/chat/completions'
            }
        }, rootToken);

        const response = await requestHelper.post(`/vendor/${vendor.body.id}/test.json`, {
            format: 'openai',
            model: 'special-model-123'
        }, rootToken);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
    });

    it('should test vendor connectivity (Anthropic format)', async () => {
        const vendor = await requestHelper.post('/vendor/create.json', {
            type: 'other',
            name: 'Test Anthropic',
            token: 'test-token',
            urls: {
                anthropic: 'http://localhost:9999/v1/messages'
            }
        }, rootToken);

        const response = await requestHelper.post(`/vendor/${vendor.body.id}/test.json`, {
            format: 'anthropic',
            model: 'claude-3-opus'
        }, rootToken);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body).toHaveProperty('status', 200);
    });

    it('should return failure for invalid URL', async () => {
        const vendor = await requestHelper.post('/vendor/create.json', {
            type: 'other',
            name: 'Invalid URL Vendor',
            token: 'test-token',
            urls: {
                openai: 'http://localhost:12345/invalid' // Non-existent port
            }
        }, rootToken);

        const response = await requestHelper.post(`/vendor/${vendor.body.id}/test.json`, {
            format: 'openai'
        }, rootToken);

        // fetch will throw, our controller returns 200 (test result wrapper)
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(false);
        expect(response.body).toHaveProperty('error');
    });

    it('should use api_key auth by default for Anthropic vendors', async () => {
        const vendor = await requestHelper.post('/vendor/create.json', {
            type: 'other',
            name: 'API Key Auth Vendor',
            token: 'sk-ant-test-key',
            urls: {
                anthropic: 'http://localhost:9999/v1/messages'
            }
        }, rootToken);

        const response = await requestHelper.post(`/vendor/${vendor.body.id}/test.json`, {
            format: 'anthropic',
            model: 'claude-3-opus'
        }, rootToken);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
    });

    it('should use bearer_token auth when configured', async () => {
        const vendor = await requestHelper.post('/vendor/create.json', {
            type: 'other',
            name: 'Bearer Token Auth Vendor',
            token: 'sk-ant-bearer-key',
            urls: {
                anthropic: 'http://localhost:9999/v1/messages'
            },
            config: { auth_mode: 'bearer_token' }
        }, rootToken);

        const response = await requestHelper.post(`/vendor/${vendor.body.id}/test.json`, {
            format: 'anthropic',
            model: 'claude-3-opus'
        }, rootToken);

        // mock server 也接受 Bearer token，所以应该成功
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.request_headers["anthropic-version"]).toBe("2023-06-01");
    });

    it('should use api_key auth when explicitly configured', async () => {
        const vendor = await requestHelper.post('/vendor/create.json', {
            type: 'other',
            name: 'Explicit API Key Vendor',
            token: 'sk-ant-explicit-key',
            urls: {
                anthropic: 'http://localhost:9999/v1/messages'
            },
            config: { auth_mode: 'api_key' }
        }, rootToken);

        const response = await requestHelper.post(`/vendor/${vendor.body.id}/test.json`, {
            format: 'anthropic',
            model: 'claude-3-opus'
        }, rootToken);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.request_headers["anthropic-version"]).toBe("2023-06-01");
    });
});
