"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._generateChallengeInternals = void 0;
exports.generateChallenge = generateChallenge;
const index_js_1 = require("./iso/index.js");
/**
 * Generate a suitably random value to be used as an attestation or assertion challenge
 */
async function generateChallenge() {
    /**
     * WebAuthn spec says that 16 bytes is a good minimum:
     *
     * "In order to prevent replay attacks, the challenges MUST contain enough entropy to make
     * guessing them infeasible. Challenges SHOULD therefore be at least 16 bytes long."
     *
     * Just in case, let's double it
     */
    const challenge = new Uint8Array(32);
    await index_js_1.isoCrypto.getRandomValues(challenge);
    return exports._generateChallengeInternals.stubThis(challenge);
}
/**
 * Make it possible to stub the return value during testing
 * @ignore Don't include this in docs output
 */
exports._generateChallengeInternals = {
    stubThis: (value) => value,
};
