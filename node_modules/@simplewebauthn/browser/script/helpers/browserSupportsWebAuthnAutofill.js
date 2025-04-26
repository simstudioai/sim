"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._browserSupportsWebAuthnAutofillInternals = void 0;
exports.browserSupportsWebAuthnAutofill = browserSupportsWebAuthnAutofill;
const browserSupportsWebAuthn_js_1 = require("./browserSupportsWebAuthn.js");
/**
 * Determine if the browser supports conditional UI, so that WebAuthn credentials can
 * be shown to the user in the browser's typical password autofill popup.
 */
function browserSupportsWebAuthnAutofill() {
    if (!(0, browserSupportsWebAuthn_js_1.browserSupportsWebAuthn)()) {
        return exports._browserSupportsWebAuthnAutofillInternals.stubThis(new Promise((resolve) => resolve(false)));
    }
    /**
     * I don't like the `as unknown` here but there's a `declare var PublicKeyCredential` in
     * TS' DOM lib that's making it difficult for me to just go `as PublicKeyCredentialFuture` as I
     * want. I think I'm fine with this for now since it's _supposed_ to be temporary, until TS types
     * have a chance to catch up.
     */
    const globalPublicKeyCredential = globalThis
        .PublicKeyCredential;
    if (globalPublicKeyCredential?.isConditionalMediationAvailable === undefined) {
        return exports._browserSupportsWebAuthnAutofillInternals.stubThis(new Promise((resolve) => resolve(false)));
    }
    return exports._browserSupportsWebAuthnAutofillInternals.stubThis(globalPublicKeyCredential.isConditionalMediationAvailable());
}
// Make it possible to stub the return value during testing
exports._browserSupportsWebAuthnAutofillInternals = {
    stubThis: (value) => value,
};
