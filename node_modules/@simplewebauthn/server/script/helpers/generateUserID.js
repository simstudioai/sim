"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._generateUserIDInternals = void 0;
exports.generateUserID = generateUserID;
const index_js_1 = require("./iso/index.js");
/**
 * Generate a suitably random value to be used as user ID
 */
async function generateUserID() {
    /**
     * WebAuthn spec says user.id has a max length of 64 bytes. I prefer how 32 random bytes look
     * after they're base64url-encoded so I'm choosing to go with that here.
     */
    const newUserID = new Uint8Array(32);
    await index_js_1.isoCrypto.getRandomValues(newUserID);
    return exports._generateUserIDInternals.stubThis(newUserID);
}
/**
 * Make it possible to stub the return value during testing
 * @ignore Don't include this in docs output
 */
exports._generateUserIDInternals = {
    stubThis: (value) => value,
};
