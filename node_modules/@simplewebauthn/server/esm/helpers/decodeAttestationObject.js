import { isoCBOR } from './iso/index.js';
/**
 * Convert an AttestationObject buffer to a proper object
 *
 * @param base64AttestationObject Attestation Object buffer
 */
export function decodeAttestationObject(attestationObject) {
    return _decodeAttestationObjectInternals.stubThis(isoCBOR.decodeFirst(attestationObject));
}
/**
 * Make it possible to stub the return value during testing
 * @ignore Don't include this in docs output
 */
export const _decodeAttestationObjectInternals = {
    stubThis: (value) => value,
};
