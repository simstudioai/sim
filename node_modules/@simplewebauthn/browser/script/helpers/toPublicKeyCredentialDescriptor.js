"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toPublicKeyCredentialDescriptor = toPublicKeyCredentialDescriptor;
const base64URLStringToBuffer_js_1 = require("./base64URLStringToBuffer.js");
function toPublicKeyCredentialDescriptor(descriptor) {
    const { id } = descriptor;
    return {
        ...descriptor,
        id: (0, base64URLStringToBuffer_js_1.base64URLStringToBuffer)(id),
        /**
         * `descriptor.transports` is an array of our `AuthenticatorTransportFuture` that includes newer
         * transports that TypeScript's DOM lib is ignorant of. Convince TS that our list of transports
         * are fine to pass to WebAuthn since browsers will recognize the new value.
         */
        transports: descriptor.transports,
    };
}
