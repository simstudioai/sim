"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._browserSupportsWebAuthnInternals = void 0;
exports.browserSupportsWebAuthn = browserSupportsWebAuthn;
/**
 * Determine if the browser is capable of Webauthn
 */
function browserSupportsWebAuthn() {
    return exports._browserSupportsWebAuthnInternals.stubThis(globalThis?.PublicKeyCredential !== undefined &&
        typeof globalThis.PublicKeyCredential === 'function');
}
/**
 * Make it possible to stub the return value during testing
 * @ignore Don't include this in docs output
 */
exports._browserSupportsWebAuthnInternals = {
    stubThis: (value) => value,
};
