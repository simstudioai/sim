import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from '../types/index.js';
export type StartAuthenticationOpts = Parameters<typeof startAuthentication>[0];
/**
 * Begin authenticator "login" via WebAuthn assertion
 *
 * @param optionsJSON Output from **@simplewebauthn/server**'s `generateAuthenticationOptions()`
 * @param useBrowserAutofill (Optional) Initialize conditional UI to enable logging in via browser autofill prompts. Defaults to `false`.
 * @param verifyBrowserAutofillInput (Optional) Ensure a suitable `<input>` element is present when `useBrowserAutofill` is `true`. Defaults to `true`.
 */
export declare function startAuthentication(options: {
    optionsJSON: PublicKeyCredentialRequestOptionsJSON;
    useBrowserAutofill?: boolean;
    verifyBrowserAutofillInput?: boolean;
}): Promise<AuthenticationResponseJSON>;
//# sourceMappingURL=startAuthentication.d.ts.map