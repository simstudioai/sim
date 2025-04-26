import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from '../types/index.js';
export type StartRegistrationOpts = Parameters<typeof startRegistration>[0];
/**
 * Begin authenticator "registration" via WebAuthn attestation
 *
 * @param optionsJSON Output from **@simplewebauthn/server**'s `generateRegistrationOptions()`
 * @param useAutoRegister (Optional) Try to silently create a passkey with the password manager that the user just signed in with. Defaults to `false`.
 */
export declare function startRegistration(options: {
    optionsJSON: PublicKeyCredentialCreationOptionsJSON;
    useAutoRegister?: boolean;
}): Promise<RegistrationResponseJSON>;
//# sourceMappingURL=startRegistration.d.ts.map