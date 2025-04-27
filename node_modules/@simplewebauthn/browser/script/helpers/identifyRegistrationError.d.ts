import { WebAuthnError } from './webAuthnError.js';
/**
 * Attempt to intuit _why_ an error was raised after calling `navigator.credentials.create()`
 */
export declare function identifyRegistrationError({ error, options, }: {
    error: Error;
    options: CredentialCreationOptions;
}): WebAuthnError | Error;
//# sourceMappingURL=identifyRegistrationError.d.ts.map