import { describe, it, expect } from "vitest";
import { SgVendorModel } from "../../../src/model/sgVendorModel";
import { ApiFormat } from "../../../src/constants";

/**
 * SgVendorModel.allowed_formats 语义测试
 *
 * allowed_formats 仅在 SQL NULL（未指定）时返回 null，由路由层回退到
 * vendor 按 URL 自动判断支持的格式；合法数组作为硬限制白名单，损坏值失败关闭。
 */

function makeVendorModel(allowedFormats: string | null): SgVendorModel {
    const vm = new SgVendorModel();
    vm.allowed_formats = allowedFormats;
    return vm;
}


describe("SgVendorModel.getSupportedFormats", () => {
    it("returns null when allowed_formats is unset, letting routing fall back to vendor URL detection", () => {
        const vm = makeVendorModel(null);
        expect(vm.getSupportedFormats()).toBeNull();
    });

    it("fails closed when allowed_formats is an empty string", () => {
        const vm = makeVendorModel("");
        expect(vm.getSupportedFormats()).toEqual([]);
    });

    it("returns the parsed allowlist as a hard restriction", () => {
        const vm = makeVendorModel(JSON.stringify([ApiFormat.OPENAI, ApiFormat.ANTHROPIC]));
        expect(vm.getSupportedFormats()).toEqual([ApiFormat.OPENAI, ApiFormat.ANTHROPIC]);
    });

    it("returns empty array for an explicitly empty allowlist, blocking all formats", () => {
        const vm = makeVendorModel("[]");
        expect(vm.getSupportedFormats()).toEqual([]);
    });


    it.each([
        "not-json",
        JSON.stringify({ format: ApiFormat.OPENAI }),
        JSON.stringify([ApiFormat.OPENAI, "invalid"]),
        JSON.stringify([ApiFormat.OPENAI, null]),
    ])("fails closed for malformed persisted allowlist %s", allowedFormats => {
        const vm = makeVendorModel(allowedFormats);
        expect(vm.getSupportedFormats()).toEqual([]);
    });


    it("deduplicates a valid persisted allowlist", () => {
        const vm = makeVendorModel(JSON.stringify([
            ApiFormat.OPENAI,
            ApiFormat.OPENAI,
            ApiFormat.RESPONSES,
        ]));
        expect(vm.getSupportedFormats()).toEqual([ApiFormat.OPENAI, ApiFormat.RESPONSES]);
    });
});
