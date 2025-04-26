import { WebAuthnError } from './webAuthnError.js';
/**
 * Attempt to intuit _why_ an error was raised after calling `navigator.credentials.get()`
 */
export declare function identifyAuthenticationError({ error, options, }: {
    error: Error;
    options: CredentialRequestOptions;
}): WebAuthnError | Error;
//# sourceMappingURL=identifyAuthenticationError.d.ts.map