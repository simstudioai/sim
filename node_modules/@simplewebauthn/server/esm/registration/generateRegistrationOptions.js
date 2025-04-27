import { generateChallenge } from '../helpers/generateChallenge.js';
import { generateUserID } from '../helpers/generateUserID.js';
import { isoBase64URL, isoUint8Array } from '../helpers/iso/index.js';
/**
 * Supported crypto algo identifiers
 * See https://w3c.github.io/webauthn/#sctn-alg-identifier
 * and https://www.iana.org/assignments/cose/cose.xhtml#algorithms
 */
export const supportedCOSEAlgorithmIdentifiers = [
    // EdDSA (In first position to encourage authenticators to use this over ES256)
    -8,
    // ECDSA w/ SHA-256
    -7,
    // ECDSA w/ SHA-512
    -36,
    // RSASSA-PSS w/ SHA-256
    -37,
    // RSASSA-PSS w/ SHA-384
    -38,
    // RSASSA-PSS w/ SHA-512
    -39,
    // RSASSA-PKCS1-v1_5 w/ SHA-256
    -257,
    // RSASSA-PKCS1-v1_5 w/ SHA-384
    -258,
    // RSASSA-PKCS1-v1_5 w/ SHA-512
    -259,
    // RSASSA-PKCS1-v1_5 w/ SHA-1 (Deprecated; here for legacy support)
    -65535,
];
/**
 * Set up some default authenticator selection options as per the latest spec:
 * https://www.w3.org/TR/webauthn-2/#dictdef-authenticatorselectioncriteria
 *
 * Helps with some older platforms (e.g. Android 7.0 Nougat) that may not be aware of these
 * defaults.
 */
const defaultAuthenticatorSelection = {
    residentKey: 'preferred',
    userVerification: 'preferred',
};
/**
 * Use the most commonly-supported algorithms
 * See the following:
 *   - https://www.iana.org/assignments/cose/cose.xhtml#algorithms
 *   - https://w3c.github.io/webauthn/#dom-publickeycredentialcreationoptions-pubkeycredparams
 */
const defaultSupportedAlgorithmIDs = [-8, -7, -257];
/**
 * Prepare a value to pass into navigator.credentials.create(...) for authenticator registration
 *
 * **Options:**
 *
 * @param rpName - User-visible, "friendly" website/service name
 * @param rpID - Valid domain name (after `https://`)
 * @param userName - User's website-specific username (email, etc...)
 * @param userID **(Optional)** - User's website-specific unique ID. Defaults to generating a random identifier
 * @param challenge **(Optional)** - Random value the authenticator needs to sign and pass back. Defaults to generating a random value
 * @param userDisplayName **(Optional)** - User's actual name. Defaults to `""`
 * @param timeout **(Optional)** - How long (in ms) the user can take to complete attestation. Defaults to `60000`
 * @param attestationType **(Optional)** - Specific attestation statement. Defaults to `"none"`
 * @param excludeCredentials **(Optional)** - Authenticators registered by the user so the user can't register the same credential multiple times. Defaults to `[]`
 * @param authenticatorSelection **(Optional)** - Advanced criteria for restricting the types of authenticators that may be used. Defaults to `{ residentKey: 'preferred', userVerification: 'preferred' }`
 * @param extensions **(Optional)** - Additional plugins the authenticator or browser should use during attestation
 * @param supportedAlgorithmIDs **(Optional)** - Array of numeric COSE algorithm identifiers supported for attestation by this RP. See https://www.iana.org/assignments/cose/cose.xhtml#algorithms. Defaults to `[-8, -7, -257]`
 * @param preferredAuthenticatorType **(Optional)** - Encourage the browser to prompt the user to register a specific type of authenticator
 */
export async function generateRegistrationOptions(options) {
    const { rpName, rpID, userName, userID, challenge = await generateChallenge(), userDisplayName = '', timeout = 60000, attestationType = 'none', excludeCredentials = [], authenticatorSelection = defaultAuthenticatorSelection, extensions, supportedAlgorithmIDs = defaultSupportedAlgorithmIDs, preferredAuthenticatorType, } = options;
    /**
     * Prepare pubKeyCredParams from the array of algorithm ID's
     */
    const pubKeyCredParams = supportedAlgorithmIDs.map((id) => ({
        alg: id,
        type: 'public-key',
    }));
    /**
     * Capture some of the nuances of how `residentKey` and `requireResidentKey` how either is set
     * depending on when either is defined in the options
     */
    if (authenticatorSelection.residentKey === undefined) {
        /**
         * `residentKey`: "If no value is given then the effective value is `required` if
         * requireResidentKey is true or `discouraged` if it is false or absent."
         *
         * See https://www.w3.org/TR/webauthn-2/#dom-authenticatorselectioncriteria-residentkey
         */
        if (authenticatorSelection.requireResidentKey) {
            authenticatorSelection.residentKey = 'required';
        }
        else {
            /**
             * FIDO Conformance v1.7.2 fails the first test if we do this, even though this is
             * technically compatible with the WebAuthn L2 spec...
             */
            // authenticatorSelection.residentKey = 'discouraged';
        }
    }
    else {
        /**
         * `requireResidentKey`: "Relying Parties SHOULD set it to true if, and only if, residentKey is
         * set to "required""
         *
         * Spec says this property defaults to `false` so we should still be okay to assign `false` too
         *
         * See https://www.w3.org/TR/webauthn-2/#dom-authenticatorselectioncriteria-requireresidentkey
         */
        authenticatorSelection.requireResidentKey = authenticatorSelection.residentKey === 'required';
    }
    /**
     * Preserve ability to specify `string` values for challenges
     */
    let _challenge = challenge;
    if (typeof _challenge === 'string') {
        _challenge = isoUint8Array.fromUTF8String(_challenge);
    }
    /**
     * Explicitly disallow use of strings for userID anymore because `isoBase64URL.fromBuffer()` below
     * will return an empty string if one gets through!
     */
    if (typeof userID === 'string') {
        throw new Error(`String values for \`userID\` are no longer supported. See https://simplewebauthn.dev/docs/advanced/server/custom-user-ids`);
    }
    /**
     * Generate a user ID if one is not provided
     */
    let _userID = userID;
    if (!_userID) {
        _userID = await generateUserID();
    }
    /**
     * Map authenticator preference to hints. Map to authenticatorAttachment as well for
     * backwards-compatibility.
     */
    const hints = [];
    if (preferredAuthenticatorType) {
        if (preferredAuthenticatorType === 'securityKey') {
            hints.push('security-key');
            authenticatorSelection.authenticatorAttachment = 'cross-platform';
        }
        else if (preferredAuthenticatorType === 'localDevice') {
            hints.push('client-device');
            authenticatorSelection.authenticatorAttachment = 'platform';
        }
        else if (preferredAuthenticatorType === 'remoteDevice') {
            hints.push('hybrid');
            authenticatorSelection.authenticatorAttachment = 'cross-platform';
        }
    }
    return {
        challenge: isoBase64URL.fromBuffer(_challenge),
        rp: {
            name: rpName,
            id: rpID,
        },
        user: {
            id: isoBase64URL.fromBuffer(_userID),
            name: userName,
            displayName: userDisplayName,
        },
        pubKeyCredParams,
        timeout,
        attestation: attestationType,
        excludeCredentials: excludeCredentials.map((cred) => {
            if (!isoBase64URL.isBase64URL(cred.id)) {
                throw new Error(`excludeCredential id "${cred.id}" is not a valid base64url string`);
            }
            return {
                ...cred,
                id: isoBase64URL.trimPadding(cred.id),
                type: 'public-key',
            };
        }),
        authenticatorSelection,
        extensions: {
            ...extensions,
            credProps: true,
        },
        hints,
    };
}
