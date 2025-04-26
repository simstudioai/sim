/**
 * Convert authenticator extension data buffer to a proper object
 *
 * @param extensionData Authenticator Extension Data buffer
 */
export declare function decodeAuthenticatorExtensions(extensionData: Uint8Array): AuthenticationExtensionsAuthenticatorOutputs | undefined;
/**
 * Attempt to support authenticator extensions we might not know about in WebAuthn
 */
export type AuthenticationExtensionsAuthenticatorOutputs = unknown;
//# sourceMappingURL=decodeAuthenticatorExtensions.d.ts.map