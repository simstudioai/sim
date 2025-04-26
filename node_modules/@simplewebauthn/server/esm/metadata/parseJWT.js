import { isoBase64URL } from '../helpers/iso/index.js';
/**
 * Process a JWT into Javascript-friendly data structures
 */
export function parseJWT(jwt) {
    const parts = jwt.split('.');
    return [
        JSON.parse(isoBase64URL.toUTF8String(parts[0])),
        JSON.parse(isoBase64URL.toUTF8String(parts[1])),
        parts[2],
    ];
}
