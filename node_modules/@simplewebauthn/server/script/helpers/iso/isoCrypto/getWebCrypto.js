"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._getWebCryptoInternals = exports.MissingWebCrypto = void 0;
exports.getWebCrypto = getWebCrypto;
let webCrypto = undefined;
/**
 * Try to get an instance of the Crypto API from the current runtime. Should support Node,
 * as well as others, like Deno, that implement Web APIs.
 */
function getWebCrypto() {
    /**
     * Hello there! If you came here wondering why this method is asynchronous when use of
     * `globalThis.crypto` is not, it's to minimize a bunch of refactor related to making this
     * synchronous. For example, `generateRegistrationOptions()` and `generateAuthenticationOptions()`
     * become synchronous if we make this synchronous (since nothing else in that method is async)
     * which represents a breaking API change in this library's core API.
     *
     * TODO: If it's after February 2025 when you read this then consider whether it still makes sense
     * to keep this method asynchronous.
     */
    const toResolve = new Promise((resolve, reject) => {
        if (webCrypto) {
            return resolve(webCrypto);
        }
        /**
         * Naively attempt to access Crypto as a global object, which popular ESM-centric run-times
         * support (and Node v20+)
         */
        const _globalThisCrypto = exports._getWebCryptoInternals.stubThisGlobalThisCrypto();
        if (_globalThisCrypto) {
            webCrypto = _globalThisCrypto;
            return resolve(webCrypto);
        }
        // We tried to access it both in Node and globally, so bail out
        return reject(new MissingWebCrypto());
    });
    return toResolve;
}
class MissingWebCrypto extends Error {
    constructor() {
        const message = 'An instance of the Crypto API could not be located';
        super(message);
        this.name = 'MissingWebCrypto';
    }
}
exports.MissingWebCrypto = MissingWebCrypto;
// Make it possible to stub return values during testing
exports._getWebCryptoInternals = {
    stubThisGlobalThisCrypto: () => globalThis.crypto,
    // Make it possible to reset the `webCrypto` at the top of the file
    setCachedCrypto: (newCrypto) => {
        webCrypto = newCrypto;
    },
};
