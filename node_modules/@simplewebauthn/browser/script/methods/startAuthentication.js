"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startAuthentication = startAuthentication;
const bufferToBase64URLString_js_1 = require("../helpers/bufferToBase64URLString.js");
const base64URLStringToBuffer_js_1 = require("../helpers/base64URLStringToBuffer.js");
const browserSupportsWebAuthn_js_1 = require("../helpers/browserSupportsWebAuthn.js");
const browserSupportsWebAuthnAutofill_js_1 = require("../helpers/browserSupportsWebAuthnAutofill.js");
const toPublicKeyCredentialDescriptor_js_1 = require("../helpers/toPublicKeyCredentialDescriptor.js");
const identifyAuthenticationError_js_1 = require("../helpers/identifyAuthenticationError.js");
const webAuthnAbortService_js_1 = require("../helpers/webAuthnAbortService.js");
const toAuthenticatorAttachment_js_1 = require("../helpers/toAuthenticatorAttachment.js");
/**
 * Begin authenticator "login" via WebAuthn assertion
 *
 * @param optionsJSON Output from **@simplewebauthn/server**'s `generateAuthenticationOptions()`
 * @param useBrowserAutofill (Optional) Initialize conditional UI to enable logging in via browser autofill prompts. Defaults to `false`.
 * @param verifyBrowserAutofillInput (Optional) Ensure a suitable `<input>` element is present when `useBrowserAutofill` is `true`. Defaults to `true`.
 */
async function startAuthentication(options) {
    // @ts-ignore: Intentionally check for old call structure to warn about improper API call
    if (!options.optionsJSON && options.challenge) {
        console.warn('startAuthentication() was not called correctly. It will try to continue with the provided options, but this call should be refactored to use the expected call structure instead. See https://simplewebauthn.dev/docs/packages/browser#typeerror-cannot-read-properties-of-undefined-reading-challenge for more information.');
        // @ts-ignore: Reassign the options, passed in as a positional argument, to the expected variable
        options = { optionsJSON: options };
    }
    const { optionsJSON, useBrowserAutofill = false, verifyBrowserAutofillInput = true, } = options;
    if (!(0, browserSupportsWebAuthn_js_1.browserSupportsWebAuthn)()) {
        throw new Error('WebAuthn is not supported in this browser');
    }
    // We need to avoid passing empty array to avoid blocking retrieval
    // of public key
    let allowCredentials;
    if (optionsJSON.allowCredentials?.length !== 0) {
        allowCredentials = optionsJSON.allowCredentials?.map(toPublicKeyCredentialDescriptor_js_1.toPublicKeyCredentialDescriptor);
    }
    // We need to convert some values to Uint8Arrays before passing the credentials to the navigator
    const publicKey = {
        ...optionsJSON,
        challenge: (0, base64URLStringToBuffer_js_1.base64URLStringToBuffer)(optionsJSON.challenge),
        allowCredentials,
    };
    // Prepare options for `.get()`
    const getOptions = {};
    /**
     * Set up the page to prompt the user to select a credential for authentication via the browser's
     * input autofill mechanism.
     */
    if (useBrowserAutofill) {
        if (!(await (0, browserSupportsWebAuthnAutofill_js_1.browserSupportsWebAuthnAutofill)())) {
            throw Error('Browser does not support WebAuthn autofill');
        }
        // Check for an <input> with "webauthn" in its `autocomplete` attribute
        const eligibleInputs = document.querySelectorAll("input[autocomplete$='webauthn']");
        // WebAuthn autofill requires at least one valid input
        if (eligibleInputs.length < 1 && verifyBrowserAutofillInput) {
            throw Error('No <input> with "webauthn" as the only or last value in its `autocomplete` attribute was detected');
        }
        // `CredentialMediationRequirement` doesn't know about "conditional" yet as of
        // typescript@4.6.3
        getOptions.mediation = 'conditional';
        // Conditional UI requires an empty allow list
        publicKey.allowCredentials = [];
    }
    // Finalize options
    getOptions.publicKey = publicKey;
    // Set up the ability to cancel this request if the user attempts another
    getOptions.signal = webAuthnAbortService_js_1.WebAuthnAbortService.createNewAbortSignal();
    // Wait for the user to complete assertion
    let credential;
    try {
        credential = (await navigator.credentials.get(getOptions));
    }
    catch (err) {
        throw (0, identifyAuthenticationError_js_1.identifyAuthenticationError)({ error: err, options: getOptions });
    }
    if (!credential) {
        throw new Error('Authentication was not completed');
    }
    const { id, rawId, response, type } = credential;
    let userHandle = undefined;
    if (response.userHandle) {
        userHandle = (0, bufferToBase64URLString_js_1.bufferToBase64URLString)(response.userHandle);
    }
    // Convert values to base64 to make it easier to send back to the server
    return {
        id,
        rawId: (0, bufferToBase64URLString_js_1.bufferToBase64URLString)(rawId),
        response: {
            authenticatorData: (0, bufferToBase64URLString_js_1.bufferToBase64URLString)(response.authenticatorData),
            clientDataJSON: (0, bufferToBase64URLString_js_1.bufferToBase64URLString)(response.clientDataJSON),
            signature: (0, bufferToBase64URLString_js_1.bufferToBase64URLString)(response.signature),
            userHandle,
        },
        type,
        clientExtensionResults: credential.getClientExtensionResults(),
        authenticatorAttachment: (0, toAuthenticatorAttachment_js_1.toAuthenticatorAttachment)(credential.authenticatorAttachment),
    };
}
