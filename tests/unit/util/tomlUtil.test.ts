import { describe, expect, it } from "vitest";
import tomlUtil from "../../../src/util/tomlUtil";


describe("tomlUtil", () => {
    describe("deleteRootTomlValue", () => {
        it("deletes a single root-level value", () => {
            const content = `model = "gpt-5"
base_url = "http://old-server:8080"
wire_api = "responses"

[model_providers.gt_ai_gateway]
name = "XY Gateway"
`;

            const result = tomlUtil.deleteRootTomlValue(content, "base_url");

            expect(result).not.toContain("base_url = \"http://old-server:8080\"");
            expect(result).toContain("wire_api = \"responses\"");
            expect(result).toContain("[model_providers.gt_ai_gateway]");
        });

        it("deletes all duplicate root-level values", () => {
            const content = `model = "gpt-5"
base_url = "http://old-server:8080"
wire_api = "responses"
experimental_bearer_token = "old-token-1"
base_url = "http://old-server:9090"
wire_api = "responses"
experimental_bearer_token = "old-token-2"

[model_providers.gt_ai_gateway]
name = "XY Gateway"
base_url = "http://127.0.0.1:8720/llm/v1"
wire_api = "responses"
experimental_bearer_token = "new-token"
`;

            let result = content;
            result = tomlUtil.deleteRootTomlValue(result, "base_url");
            result = tomlUtil.deleteRootTomlValue(result, "wire_api");
            result = tomlUtil.deleteRootTomlValue(result, "experimental_bearer_token");

            // Should not have any root-level base_url, wire_api, or experimental_bearer_token
            const rootSection = result.substring(0, result.indexOf("[model_providers"));
            expect(rootSection).not.toMatch(/base_url\s*=/);
            expect(rootSection).not.toMatch(/wire_api\s*=/);
            expect(rootSection).not.toMatch(/experimental_bearer_token\s*=/);

            // Should still have the table values
            expect(result).toContain("[model_providers.gt_ai_gateway]");
            expect(result).toContain("base_url = \"http://127.0.0.1:8720/llm/v1\"");
            expect(result).toContain("experimental_bearer_token = \"new-token\"");
        });

        it("does not affect values inside tables", () => {
            const content = `model = "gpt-5"

[model_providers.gt_ai_gateway]
base_url = "http://127.0.0.1:8720/llm/v1"
wire_api = "responses"
experimental_bearer_token = "new-token"
`;

            const result = tomlUtil.deleteRootTomlValue(content, "base_url");

            // Should not affect table values
            expect(result).toContain("[model_providers.gt_ai_gateway]");
            expect(result).toContain("base_url = \"http://127.0.0.1:8720/llm/v1\"");
        });

        it("handles content without tables", () => {
            const content = `model = "gpt-5"
base_url = "http://old-server:8080"
wire_api = "responses"
`;

            const result = tomlUtil.deleteRootTomlValue(content, "base_url");

            expect(result).not.toContain("base_url");
            expect(result).toContain("wire_api = \"responses\"");
        });

        it("handles empty content", () => {
            const result = tomlUtil.deleteRootTomlValue("", "base_url");
            expect(result).toBe("");
        });
    });
});
