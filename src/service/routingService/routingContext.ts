class RoutingContext {
    private triedUpstreams = new Set<string>();


    private key(vendorId: number, vendorModelName: string, upstreamFormat?: string): string {
        return `${vendorId}:${vendorModelName}:${upstreamFormat ?? "*"}`;
    }


    hasTried(vendorId: number, vendorModelName: string, upstreamFormat?: string): boolean {
        return this.triedUpstreams.has(this.key(vendorId, vendorModelName, upstreamFormat))
            || this.triedUpstreams.has(this.key(vendorId, vendorModelName));
    }


    markTried(vendorId: number, vendorModelName: string, upstreamFormat?: string): void {
        this.triedUpstreams.add(this.key(vendorId, vendorModelName, upstreamFormat));
    }
}

export default RoutingContext;
