import { isoCrypto } from './iso/index.js';
/**
 * Generate a suitably random value to be used as user ID
 */
export async function generateUserID() {
    /**
     * WebAuthn spec says user.id has a max length of 64 bytes. I prefer how 32 random bytes look
     * after they're base64url-encoded so I'm choosing to go with that here.
     */
    const newUserID = new Uint8Array(32);
    await isoCrypto.getRandomValues(newUserID);
    return _generateUserIDInternals.stubThis(newUserID);
}
/**
 * Make it possible to stub the return value during testing
 * @ignore Don't include this in docs output
 */
export const _generateUserIDInternals = {
    stubThis: (value) => value,
};
