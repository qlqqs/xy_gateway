import type { ClientConfigFileContent, ClientConfigContent } from "./types";
import BaseConfigAdapter from "./baseConfigAdapter";
import tomlUtil from "../../util/tomlUtil";
import { APP_NAME, ClientName, ConnectionMode, ApiFormat } from "../../constants";
import path from "path";


class CodexConfigAdapter extends BaseConfigAdapter {
    readonly authPath: string;
    readonly protocol: ApiFormat = ApiFormat.RESPONSES;
    readonly defaultGatewaySuffix = "/llm/v1";
    private static readonly RESERVED_PROVIDER_IDS = ["openai", "ollama"];

    constructor(homeDir: string) {
        const codexHome = process.env.CODEX_HOME || path.join(homeDir, ".codex");
        super(
            ClientName.CODEX,
            "Codex",
            [path.join(codexHome, "config.toml"), path.join(codexHome, "auth.json")]
        );
        this.authPath = this.configPaths[1];
    }

    private buildBaseUrl(fields: ClientConfigContent): string {
        const url = fields.gatewayUrl.replace(/\/+$/, "");
        if ((fields.connectionMode || ConnectionMode.GATEWAY) === ConnectionMode.VENDOR) {
            return url
                .replace(/\/responses\/?$/, "")
                .replace(/\/chat\/completions\/?$/, "");
        }
        if (url.endsWith(this.defaultGatewaySuffix)) {
            return url;
        }
        return `${url}${this.defaultGatewaySuffix}`;
    }

    parseConfigFileContent(configContent: ClientConfigFileContent, connectionMode?: ConnectionMode): ClientConfigContent | null {
        const content = configContent[this.configPaths[0]] || "";
        if (!content) {
            return null;
        }

        const providerRaw = tomlUtil.getTomlValue(content, "model_provider") || "";
        const provider = providerRaw || "openai";

        // Check if config.toml has a reserved provider ID in model_providers table
        // This is invalid and indicates the config was modified incorrectly
        if (CodexConfigAdapter.RESERVED_PROVIDER_IDS.includes(provider)) {
            const providerTable = `model_providers.${provider}`;
            if (tomlUtil.getTomlTableValue(content, providerTable, "base_url") !== null ||
                tomlUtil.getTomlTableValue(content, providerTable, "experimental_bearer_token") !== null) {
                return null;
            }
        }

        const providerTable = provider ? `model_providers.${provider}` : "";
        const backendUrl = providerTable ? tomlUtil.getTomlTableValue(content, providerTable, "base_url") || "" : "";
        let token = providerTable ? tomlUtil.getTomlTableValue(content, providerTable, "experimental_bearer_token") || "" : "";

        // Parse auth.json content
        let authJson: Record<string, any> | undefined;
        if (configContent[this.configPaths[1]]) {
            try {
                authJson = JSON.parse(configContent[this.configPaths[1]]);
                if (!token && authJson?.tokens?.access_token) {
                    token = authJson.tokens.access_token;
                }
            } catch (e) {
                // Ignore parsing errors for auth.json
            }
        }

        // Determine connection mode
        // Priority: 1. Use existing connectionMode if available, 2. Infer from URL/provider
        let mode: ConnectionMode;
        if (provider === "openai" || !backendUrl || backendUrl === "https://api.openai.com") {
            mode = ConnectionMode.OFFICIAL;
        } else if (this.isGatewayUrl(backendUrl)) {
            mode = ConnectionMode.GATEWAY;
        } else {
            mode = ConnectionMode.VENDOR;
        }

        if (!token) {
            return null;
        }

        return {
            version: "v1",
            connectionMode: mode,
            gatewayUrl: backendUrl,
            apiKey: token,
            model: tomlUtil.getTomlValue(content, "model") || "",
            authJson,
        };
    }

    patchConfigFileContent(configContent: ClientConfigFileContent, fields: ClientConfigContent, connectionMode?: ConnectionMode): ClientConfigFileContent {
        let content = configContent[this.configPaths[0]] || "";

        // Check if config uses new format (has model_provider) or legacy format
        const existingModelProvider = tomlUtil.getTomlValue(content, "model_provider");
        const isNewFormat = existingModelProvider !== null;

        if (fields.connectionMode === ConnectionMode.OFFICIAL) {
            if (isNewFormat) {
                content = this.patchOfficialConfigNewFormat(content, fields);
            } else {
                content = this.patchOfficialConfigLegacyFormat(content, fields);
            }
        } else {
            if (isNewFormat) {
                content = this.patchVendorConfigNewFormat(content, fields);
            } else {
                content = this.patchVendorConfigLegacyFormat(content, fields);
            }
        }

        const result: ClientConfigFileContent = {
            [this.configPaths[0]]: `${content.trim()}\n`,
        };

        // Write auth.json based on connection mode
        if (fields.connectionMode === ConnectionMode.OFFICIAL) {
            // For OFFICIAL mode, use authJson from backup if available
            if (fields.authJson) {
                result[this.authPath] = JSON.stringify(fields.authJson, null, 2);
            } else if (fields.apiKey) {
                // Has apiKey but no authJson - update existing auth.json
                let authObj: Record<string, any> = {};
                try {
                    const existing = configContent[this.authPath] || "";
                    if (existing) authObj = JSON.parse(existing);
                } catch (_) {}
                this.writeOfficialAuth(authObj, fields.apiKey);
                result[this.authPath] = JSON.stringify(authObj, null, 2);
            }
            // else: no authJson and no apiKey - omit authPath from result,
            // writeConfig will delete the file (same as `codex logout`)
        } else {
            // For GATEWAY/VENDOR mode
            let authObj: Record<string, any> = {};
            try {
                const existing = configContent[this.authPath] || "";
                if (existing) authObj = JSON.parse(existing);
            } catch (_) {}
            this.writeVendorAuth(authObj, fields.apiKey);
            result[this.authPath] = JSON.stringify(authObj, null, 2);
        }

        return result;
    }

    private patchOfficialConfigNewFormat(content: string, fields: ClientConfigContent): string {
        // New format: write model_provider and clean up provider tables
        content = tomlUtil.upsertRootTomlValue(content, "model_provider", tomlUtil.buildTomlString("openai"));

        if (fields.model.trim()) {
            content = tomlUtil.upsertRootTomlValue(content, "model", tomlUtil.buildTomlString(fields.model.trim()));
        } else {
            content = tomlUtil.deleteRootTomlValue(content, "model");
        }

        // Codex reserves the "openai" provider ID — delete it and write to auth.json instead
        content = tomlUtil.deleteTomlTable(content, "model_providers.openai");
        content = tomlUtil.deleteTomlTable(content, "model_providers.gt_ai_gateway");

        // Clean up any legacy root-level fields
        content = tomlUtil.deleteRootTomlValue(content, "base_url");
        content = tomlUtil.deleteRootTomlValue(content, "wire_api");
        content = tomlUtil.deleteRootTomlValue(content, "experimental_bearer_token");

        return content;
    }

    private patchOfficialConfigLegacyFormat(content: string, fields: ClientConfigContent): string {
        // Legacy format: write to root level
        if (fields.model.trim()) {
            content = tomlUtil.upsertRootTomlValue(content, "model", tomlUtil.buildTomlString(fields.model.trim()));
        } else {
            content = tomlUtil.deleteRootTomlValue(content, "model");
        }

        // Clean up any duplicate root-level fields first
        content = tomlUtil.deleteRootTomlValue(content, "base_url");
        content = tomlUtil.deleteRootTomlValue(content, "wire_api");
        content = tomlUtil.deleteRootTomlValue(content, "experimental_bearer_token");

        // Then write new values
        content = tomlUtil.upsertRootTomlValue(content, "base_url", tomlUtil.buildTomlString("https://api.openai.com"));
        content = tomlUtil.upsertRootTomlValue(content, "wire_api", tomlUtil.buildTomlString("responses"));

        return content;
    }

    private patchVendorConfigNewFormat(content: string, fields: ClientConfigContent): string {
        const providerId = "gt_ai_gateway";

        // New format: write to [model_providers.<id>] table
        content = tomlUtil.upsertRootTomlValue(content, "model_provider", tomlUtil.buildTomlString(providerId));

        if (fields.model.trim()) {
            content = tomlUtil.upsertRootTomlValue(content, "model", tomlUtil.buildTomlString(fields.model.trim()));
        }

        content = tomlUtil.upsertTomlTable(content, `model_providers.${providerId}`, {
            name: tomlUtil.buildTomlString(APP_NAME),
            base_url: tomlUtil.buildTomlString(this.buildBaseUrl(fields)),
            wire_api: tomlUtil.buildTomlString("responses"),
            experimental_bearer_token: tomlUtil.buildTomlString(fields.apiKey),
        });

        // Clean up legacy root-level fields
        content = tomlUtil.deleteRootTomlValue(content, "base_url");
        content = tomlUtil.deleteRootTomlValue(content, "wire_api");
        content = tomlUtil.deleteRootTomlValue(content, "experimental_bearer_token");

        // Clean up any reserved provider ID tables
        content = tomlUtil.deleteTomlTable(content, "model_providers.openai");

        return content;
    }

    private patchVendorConfigLegacyFormat(content: string, fields: ClientConfigContent): string {
        // Legacy format: write to root level
        if (fields.model.trim()) {
            content = tomlUtil.upsertRootTomlValue(content, "model", tomlUtil.buildTomlString(fields.model.trim()));
        }

        content = tomlUtil.upsertRootTomlValue(content, "base_url", tomlUtil.buildTomlString(this.buildBaseUrl(fields)));
        content = tomlUtil.upsertRootTomlValue(content, "wire_api", tomlUtil.buildTomlString("responses"));
        content = tomlUtil.upsertRootTomlValue(content, "experimental_bearer_token", tomlUtil.buildTomlString(fields.apiKey));

        return content;
    }

    private writeOfficialAuth(authObj: Record<string, any>, apiKey: string): void {
        delete authObj.OPENAI_API_KEY;
        if (apiKey) {
            // Preserve existing tokens (id_token, refresh_token, etc.) and only update access_token
            const existingTokens = authObj.tokens || {};
            authObj.tokens = {
                ...existingTokens,
                access_token: apiKey,
            };
        }
    }

    private writeVendorAuth(authObj: Record<string, any>, apiKey: string): void {
        delete authObj.tokens;
        if (apiKey) {
            authObj.OPENAI_API_KEY = apiKey;
        }
    }

    isConfigCorrupted(configContent: ClientConfigFileContent): boolean {
        const content = configContent[this.configPaths[0]] || "";
        if (!content) {
            return false;
        }

        // Check if config.toml has a reserved provider ID in model_providers table
        const providerRaw = tomlUtil.getTomlValue(content, "model_provider") || "";
        const provider = providerRaw || "openai";

        if (CodexConfigAdapter.RESERVED_PROVIDER_IDS.includes(provider)) {
            const providerTable = `model_providers.${provider}`;
            if (tomlUtil.getTomlTableValue(content, providerTable, "base_url") !== null ||
                tomlUtil.getTomlTableValue(content, providerTable, "experimental_bearer_token") !== null) {
                return true;
            }
        }

        // Check for duplicate root-level fields by parsing
        // If parse fails, it means there are duplicate keys
        try {
            tomlUtil.parse(content);
            return false;
        } catch (e) {
            // Parse failed, which means there are duplicate keys
            return true;
        }
    }

    verifyClientConfigContent(config: ClientConfigContent): boolean {
        // Check required fields for all modes
        if (!config.connectionMode) {
            return false;
        }

        // For OFFICIAL mode, only connectionMode is required
        // model, gatewayUrl, apiKey are optional - user can login later through the client
        if (config.connectionMode === ConnectionMode.OFFICIAL) {
            return true;
        }

        // For GATEWAY/VENDOR mode, gatewayUrl, apiKey, and model are required
        return Boolean(config.gatewayUrl && config.apiKey && config.model);
    }
}


export default CodexConfigAdapter;
