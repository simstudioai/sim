interface WebAuthnAbortService {
    /**
     * Prepare an abort signal that will help support multiple auth attempts without needing to
     * reload the page. This is automatically called whenever `startRegistration()` and
     * `startAuthentication()` are called.
     */
    createNewAbortSignal(): AbortSignal;
    /**
     * Manually cancel any active WebAuthn registration or authentication attempt.
     */
    cancelCeremony(): void;
}
/**
 * A service singleton to help ensure that only a single WebAuthn ceremony is active at a time.
 *
 * Users of **@simplewebauthn/browser** shouldn't typically need to use this, but it can help e.g.
 * developers building projects that use client-side routing to better control the behavior of
 * their UX in response to router navigation events.
 */
export declare const WebAuthnAbortService: WebAuthnAbortService;
export {};
//# sourceMappingURL=webAuthnAbortService.d.ts.map