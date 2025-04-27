/**
 * Determine if the browser supports conditional UI, so that WebAuthn credentials can
 * be shown to the user in the browser's typical password autofill popup.
 */
export declare function browserSupportsWebAuthnAutofill(): Promise<boolean>;
export declare const _browserSupportsWebAuthnAutofillInternals: {
    stubThis: (value: Promise<boolean>) => Promise<boolean>;
};
//# sourceMappingURL=browserSupportsWebAuthnAutofill.d.ts.map