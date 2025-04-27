"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._fetchInternals = void 0;
exports.fetch = fetch;
/**
 * A simple method for requesting data via standard `fetch`. Should work
 * across multiple runtimes.
 */
function fetch(url) {
    return exports._fetchInternals.stubThis(url);
}
/**
 * Make it possible to stub the return value during testing
 * @ignore Don't include this in docs output
 */
exports._fetchInternals = {
    stubThis: (url) => globalThis.fetch(url),
};
