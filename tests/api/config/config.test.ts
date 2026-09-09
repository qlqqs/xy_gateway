import { beforeEach, describe, it, expect } from "vitest";
import requestHelper from "../../helpers/requestHelper";
import dbHelper from "../../helpers/dbHelper";

const ROOT_TOKEN = "root-token-123";

describe("Config API", () => {
    beforeEach(async () => {
        await dbHelper.truncate();
    });

    it("should return advanced config with request rewrite features enabled by default", async () => {
        const response = await requestHelper.get("/config.json", ROOT_TOKEN);

        expect(response.body).toBeDefined();
        expect(response.body.cch_rewrite_enabled).toBe("true");
        expect(response.body.responses_prompt_cache_key_enabled).toBe("true");
        expect(response.body.auto_update_enabled).toBe("true");
        expect(response.body).not.toHaveProperty("telemetry_disabled");
    });

    it("should update config values and return updated config", async () => {
        const updateResponse = await requestHelper.put(
            "/config.json",
            { 
                cch_rewrite_enabled: "true",
                responses_prompt_cache_key_enabled: "true",
            },
            ROOT_TOKEN,
        );

        expect(updateResponse.status).toBe(200);
        expect(updateResponse.body.cch_rewrite_enabled).toBe("true");
        expect(updateResponse.body.responses_prompt_cache_key_enabled).toBe("true");

        // Verify it persists by getting it again
        const getResponse = await requestHelper.get("/config.json", ROOT_TOKEN);
        expect(getResponse.status).toBe(200);
        expect(getResponse.body.cch_rewrite_enabled).toBe("true");
        expect(getResponse.body.responses_prompt_cache_key_enabled).toBe("true");
    });
});
