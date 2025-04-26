import type { AuthenticationExtensionsClientInputs, AuthenticatorSelectionCriteria, AuthenticatorTransportFuture, Base64URLString, COSEAlgorithmIdentifier, PublicKeyCredentialCreationOptionsJSON } from '../types/index.js';
export type GenerateRegistrationOptionsOpts = Parameters<typeof generateRegistrationOptions>[0];
/**
 * Supported crypto algo identifiers
 * See https://w3c.github.io/webauthn/#sctn-alg-identifier
 * and https://www.iana.org/assignments/cose/cose.xhtml#algorithms
 */
export declare const supportedCOSEAlgorithmIdentifiers: COSEAlgorithmIdentifier[];
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
export declare function generateRegistrationOptions(options: {
    rpName: string;
    rpID: string;
    userName: string;
    userID?: Uint8Array;
    challenge?: string | Uint8Array;
    userDisplayName?: string;
    timeout?: number;
    attestationType?: 'direct' | 'enterprise' | 'none';
    excludeCredentials?: {
        id: Base64URLString;
        transports?: AuthenticatorTransportFuture[];
    }[];
    authenticatorSelection?: AuthenticatorSelectionCriteria;
    extensions?: AuthenticationExtensionsClientInputs;
    supportedAlgorithmIDs?: COSEAlgorithmIdentifier[];
    preferredAuthenticatorType?: 'securityKey' | 'localDevice' | 'remoteDevice';
}): Promise<PublicKeyCredentialCreationOptionsJSON>;
//# sourceMappingURL=generateRegistrationOptions.d.ts.map