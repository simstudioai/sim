"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAuthenticationOptions = generateAuthenticationOptions;
const index_js_1 = require("../helpers/iso/index.js");
const generateChallenge_js_1 = require("../helpers/generateChallenge.js");
/**
 * Prepare a value to pass into navigator.credentials.get(...) for authenticator authentication
 *
 * **Options:**
 *
 * @param rpID - Valid domain name (after `https://`)
 * @param allowCredentials **(Optional)** - Authenticators previously registered by the user, if any. If undefined the client will ask the user which credential they want to use
 * @param challenge **(Optional)** - Random value the authenticator needs to sign and pass back user for authentication. Defaults to generating a random value
 * @param timeout **(Optional)** - How long (in ms) the user can take to complete authentication. Defaults to `60000`
 * @param userVerification **(Optional)** - Set to `'discouraged'` when asserting as part of a 2FA flow, otherwise set to `'preferred'` or `'required'` as desired. Defaults to `"preferred"`
 * @param extensions **(Optional)** - Additional plugins the authenticator or browser should use during authentication
 */
async function generateAuthenticationOptions(options) {
    const { allowCredentials, challenge = await (0, generateChallenge_js_1.generateChallenge)(), timeout = 60000, userVerification = 'preferred', extensions, rpID, } = options;
    /**
     * Preserve ability to specify `string` values for challenges
     */
    let _challenge = challenge;
    if (typeof _challenge === 'string') {
        _challenge = index_js_1.isoUint8Array.fromUTF8String(_challenge);
    }
    return {
        rpId: rpID,
        challenge: index_js_1.isoBase64URL.fromBuffer(_challenge),
        allowCredentials: allowCredentials?.map((cred) => {
            if (!index_js_1.isoBase64URL.isBase64URL(cred.id)) {
                throw new Error(`excludeCredential id "${cred.id}" is not a valid base64url string`);
            }
            return {
                ...cred,
                id: index_js_1.isoBase64URL.trimPadding(cred.id),
                type: 'public-key',
            };
        }),
        timeout,
        userVerification,
        extensions,
    };
}
