import { afterEach, describe, expect, it, vi } from "vitest";
import { VendorAuthMode } from "../../../src/constants";
import { SgVendor } from "../../../src/model/sgVendor";
import vendorService from "../../../src/service/vendorService";


function anthropicVendor(authMode: VendorAuthMode): SgVendor {
    return new SgVendor({
        type: "other",
        token: "anthropic-secret",
        urls: { anthropic: "https://anthropic.example/v1/messages" },
        config: {
            api_type: "anthropic",
            auth_mode: authMode,
        },
    });
}


function mockModelList(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
        data: [{ id: "claude-sonnet" }],
    }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}


afterEach(() => {
    vi.unstubAllGlobals();
});


describe("vendorService.fetchUpstreamModels", () => {
    it("uses Anthropic Bearer authentication with the required version header", async () => {
        const fetchMock = mockModelList();

        await vendorService.fetchUpstreamModels(anthropicVendor(VendorAuthMode.BEARER_TOKEN));

        const [url, init] = fetchMock.mock.calls[0];
        const headers = init?.headers as Headers;
        expect(url).toBe("https://anthropic.example/v1/models");
        expect(headers.get("Authorization")).toBe("Bearer anthropic-secret");
        expect(headers.get("x-api-key")).toBeNull();
        expect(headers.get("anthropic-version")).toBe("2023-06-01");
    });

    it("uses Anthropic API-key authentication with the required version header", async () => {
        const fetchMock = mockModelList();

        await vendorService.fetchUpstreamModels(anthropicVendor(VendorAuthMode.API_KEY));

        const [url, init] = fetchMock.mock.calls[0];
        const headers = init?.headers as Headers;
        expect(url).toBe("https://anthropic.example/v1/models");
        expect(headers.get("Authorization")).toBeNull();
        expect(headers.get("x-api-key")).toBe("anthropic-secret");
        expect(headers.get("anthropic-version")).toBe("2023-06-01");
    });
});
