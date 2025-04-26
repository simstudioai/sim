import { browserSupportsWebAuthn } from './browserSupportsWebAuthn.js';
/**
 * Determine whether the browser can communicate with a built-in authenticator, like
 * Touch ID, Android fingerprint scanner, or Windows Hello.
 *
 * This method will _not_ be able to tell you the name of the platform authenticator.
 */
export function platformAuthenticatorIsAvailable() {
    if (!browserSupportsWebAuthn()) {
        return new Promise((resolve) => resolve(false));
    }
    return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
}
