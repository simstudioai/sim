/**
 * A simple method for requesting data via standard `fetch`. Should work
 * across multiple runtimes.
 */
export declare function fetch(url: string): Promise<Response>;
/**
 * Make it possible to stub the return value during testing
 * @ignore Don't include this in docs output
 */
export declare const _fetchInternals: {
    stubThis: (url: string) => Promise<Response>;
};
//# sourceMappingURL=fetch.d.ts.map