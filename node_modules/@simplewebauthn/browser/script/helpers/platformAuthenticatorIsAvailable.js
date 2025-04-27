"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.platformAuthenticatorIsAvailable = platformAuthenticatorIsAvailable;
const browserSupportsWebAuthn_js_1 = require("./browserSupportsWebAuthn.js");
/**
 * Determine whether the browser can communicate with a built-in authenticator, like
 * Touch ID, Android fingerprint scanner, or Windows Hello.
 *
 * This method will _not_ be able to tell you the name of the platform authenticator.
 */
function platformAuthenticatorIsAvailable() {
    if (!(0, browserSupportsWebAuthn_js_1.browserSupportsWebAuthn)()) {
        return new Promise((resolve) => resolve(false));
    }
    return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
}
