/**
 * DO NOT MODIFY THESE FILES!
 *
 * These files were copied from the **types** package. To update this file, make changes to those
 * files instead and then run the following command from the monorepo root folder:
 *
 * deno task codegen:types
 */
import type { AttestationConveyancePreference, AuthenticationExtensionsClientInputs, AuthenticationExtensionsClientOutputs, AuthenticatorAssertionResponse, AuthenticatorAttachment, AuthenticatorAttestationResponse, AuthenticatorSelectionCriteria, COSEAlgorithmIdentifier, PublicKeyCredential, PublicKeyCredentialCreationOptions, PublicKeyCredentialDescriptor, PublicKeyCredentialParameters, PublicKeyCredentialRequestOptions, PublicKeyCredentialRpEntity, PublicKeyCredentialType, UserVerificationRequirement } from './dom.js';
export type { AttestationConveyancePreference, AuthenticationExtensionsClientInputs, AuthenticationExtensionsClientOutputs, AuthenticatorAssertionResponse, AuthenticatorAttachment, AuthenticatorAttestationResponse, AuthenticatorSelectionCriteria, AuthenticatorTransport, COSEAlgorithmIdentifier, Crypto, PublicKeyCredential, PublicKeyCredentialCreationOptions, PublicKeyCredentialDescriptor, PublicKeyCredentialParameters, PublicKeyCredentialRequestOptions, PublicKeyCredentialRpEntity, PublicKeyCredentialType, PublicKeyCredentialUserEntity, UserVerificationRequirement, } from './dom.js';
/**
 * A variant of PublicKeyCredentialCreationOptions suitable for JSON transmission to the browser to
 * (eventually) get passed into navigator.credentials.create(...) in the browser.
 *
 * This should eventually get replaced with official TypeScript DOM types when WebAuthn L3 types
 * eventually make it into the language:
 *
 * https://w3c.github.io/webauthn/#dictdef-publickeycredentialcreationoptionsjson
 */
export interface PublicKeyCredentialCreationOptionsJSON {
    rp: PublicKeyCredentialRpEntity;
    user: PublicKeyCredentialUserEntityJSON;
    challenge: Base64URLString;
    pubKeyCredParams: PublicKeyCredentialParameters[];
    timeout?: number;
    excludeCredentials?: PublicKeyCredentialDescriptorJSON[];
    authenticatorSelection?: AuthenticatorSelectionCriteria;
    hints?: PublicKeyCredentialHint[];
    attestation?: AttestationConveyancePreference;
    attestationFormats?: AttestationFormat[];
    extensions?: AuthenticationExtensionsClientInputs;
}
/**
 * A variant of PublicKeyCredentialRequestOptions suitable for JSON transmission to the browser to
 * (eventually) get passed into navigator.credentials.get(...) in the browser.
 */
export interface PublicKeyCredentialRequestOptionsJSON {
    challenge: Base64URLString;
    timeout?: number;
    rpId?: string;
    allowCredentials?: PublicKeyCredentialDescriptorJSON[];
    userVerification?: UserVerificationRequirement;
    hints?: PublicKeyCredentialHint[];
    extensions?: AuthenticationExtensionsClientInputs;
}
/**
 * https://w3c.github.io/webauthn/#dictdef-publickeycredentialdescriptorjson
 */
export interface PublicKeyCredentialDescriptorJSON {
    id: Base64URLString;
    type: PublicKeyCredentialType;
    transports?: AuthenticatorTransportFuture[];
}
/**
 * https://w3c.github.io/webauthn/#dictdef-publickeycredentialuserentityjson
 */
export interface PublicKeyCredentialUserEntityJSON {
    id: string;
    name: string;
    displayName: string;
}
/**
 * The value returned from navigator.credentials.create()
 */
export interface RegistrationCredential extends PublicKeyCredentialFuture {
    response: AuthenticatorAttestationResponseFuture;
}
/**
 * A slightly-modified RegistrationCredential to simplify working with ArrayBuffers that
 * are Base64URL-encoded in the browser so that they can be sent as JSON to the server.
 *
 * https://w3c.github.io/webauthn/#dictdef-registrationresponsejson
 */
export interface RegistrationResponseJSON {
    id: Base64URLString;
    rawId: Base64URLString;
    response: AuthenticatorAttestationResponseJSON;
    authenticatorAttachment?: AuthenticatorAttachment;
    clientExtensionResults: AuthenticationExtensionsClientOutputs;
    type: PublicKeyCredentialType;
}
/**
 * The value returned from navigator.credentials.get()
 */
export interface AuthenticationCredential extends PublicKeyCredentialFuture {
    response: AuthenticatorAssertionResponse;
}
/**
 * A slightly-modified AuthenticationCredential to simplify working with ArrayBuffers that
 * are Base64URL-encoded in the browser so that they can be sent as JSON to the server.
 *
 * https://w3c.github.io/webauthn/#dictdef-authenticationresponsejson
 */
export interface AuthenticationResponseJSON {
    id: Base64URLString;
    rawId: Base64URLString;
    response: AuthenticatorAssertionResponseJSON;
    authenticatorAttachment?: AuthenticatorAttachment;
    clientExtensionResults: AuthenticationExtensionsClientOutputs;
    type: PublicKeyCredentialType;
}
/**
 * A slightly-modified AuthenticatorAttestationResponse to simplify working with ArrayBuffers that
 * are Base64URL-encoded in the browser so that they can be sent as JSON to the server.
 *
 * https://w3c.github.io/webauthn/#dictdef-authenticatorattestationresponsejson
 */
export interface AuthenticatorAttestationResponseJSON {
    clientDataJSON: Base64URLString;
    attestationObject: Base64URLString;
    authenticatorData?: Base64URLString;
    transports?: AuthenticatorTransportFuture[];
    publicKeyAlgorithm?: COSEAlgorithmIdentifier;
    publicKey?: Base64URLString;
}
/**
 * A slightly-modified AuthenticatorAssertionResponse to simplify working with ArrayBuffers that
 * are Base64URL-encoded in the browser so that they can be sent as JSON to the server.
 *
 * https://w3c.github.io/webauthn/#dictdef-authenticatorassertionresponsejson
 */
export interface AuthenticatorAssertionResponseJSON {
    clientDataJSON: Base64URLString;
    authenticatorData: Base64URLString;
    signature: Base64URLString;
    userHandle?: Base64URLString;
}
/**
 * Public key credential information needed to verify authentication responses
 */
export type WebAuthnCredential = {
    id: Base64URLString;
    publicKey: Uint8Array;
    counter: number;
    transports?: AuthenticatorTransportFuture[];
};
/**
 * An attempt to communicate that this isn't just any string, but a Base64URL-encoded string
 */
export type Base64URLString = string;
/**
 * AuthenticatorAttestationResponse in TypeScript's DOM lib is outdated (up through v3.9.7).
 * Maintain an augmented version here so we can implement additional properties as the WebAuthn
 * spec evolves.
 *
 * See https://www.w3.org/TR/webauthn-2/#iface-authenticatorattestationresponse
 *
 * Properties marked optional are not supported in all browsers.
 */
export interface AuthenticatorAttestationResponseFuture extends AuthenticatorAttestationResponse {
    getTransports(): AuthenticatorTransportFuture[];
}
/**
 * A super class of TypeScript's `AuthenticatorTransport` that includes support for the latest
 * transports. Should eventually be replaced by TypeScript's when TypeScript gets updated to
 * know about it (sometime after 4.6.3)
 */
export type AuthenticatorTransportFuture = 'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb';
/**
 * A super class of TypeScript's `PublicKeyCredentialDescriptor` that knows about the latest
 * transports. Should eventually be replaced by TypeScript's when TypeScript gets updated to
 * know about it (sometime after 4.6.3)
 */
export interface PublicKeyCredentialDescriptorFuture extends Omit<PublicKeyCredentialDescriptor, 'transports'> {
    transports?: AuthenticatorTransportFuture[];
}
/** */
export type PublicKeyCredentialJSON = RegistrationResponseJSON | AuthenticationResponseJSON;
/**
 * A super class of TypeScript's `PublicKeyCredential` that knows about upcoming WebAuthn features
 */
export interface PublicKeyCredentialFuture extends PublicKeyCredential {
    type: PublicKeyCredentialType;
    isConditionalMediationAvailable?(): Promise<boolean>;
    parseCreationOptionsFromJSON?(options: PublicKeyCredentialCreationOptionsJSON): PublicKeyCredentialCreationOptions;
    parseRequestOptionsFromJSON?(options: PublicKeyCredentialRequestOptionsJSON): PublicKeyCredentialRequestOptions;
    toJSON?(): PublicKeyCredentialJSON;
}
/**
 * The two types of credentials as defined by bit 3 ("Backup Eligibility") in authenticator data:
 * - `"singleDevice"` credentials will never be backed up
 * - `"multiDevice"` credentials can be backed up
 */
export type CredentialDeviceType = 'singleDevice' | 'multiDevice';
/**
 * Categories of authenticators that Relying Parties can pass along to browsers during
 * registration. Browsers that understand these values can optimize their modal experience to
 * start the user off in a particular registration flow:
 *
 * - `hybrid`: A platform authenticator on a mobile device
 * - `security-key`: A portable FIDO2 authenticator capable of being used on multiple devices via a USB or NFC connection
 * - `client-device`: The device that WebAuthn is being called on. Typically synonymous with platform authenticators
 *
 * See https://w3c.github.io/webauthn/#enumdef-publickeycredentialhint
 *
 * These values are less strict than `authenticatorAttachment`
 */
export type PublicKeyCredentialHint = 'hybrid' | 'security-key' | 'client-device';
/**
 * Values for an attestation object's `fmt`
 *
 * See https://www.iana.org/assignments/webauthn/webauthn.xhtml#webauthn-attestation-statement-format-ids
 */
export type AttestationFormat = 'fido-u2f' | 'packed' | 'android-safetynet' | 'android-key' | 'tpm' | 'apple' | 'none';
//# sourceMappingURL=index.d.ts.map