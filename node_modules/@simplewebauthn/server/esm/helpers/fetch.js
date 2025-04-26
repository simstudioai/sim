/**
 * A simple method for requesting data via standard `fetch`. Should work
 * across multiple runtimes.
 */
export function fetch(url) {
    return _fetchInternals.stubThis(url);
}
/**
 * Make it possible to stub the return value during testing
 * @ignore Don't include this in docs output
 */
export const _fetchInternals = {
    stubThis: (url) => globalThis.fetch(url),
};
