import { mapCoseAlgToWebCryptoAlg } from './mapCoseAlgToWebCryptoAlg.js';
import { getWebCrypto } from './getWebCrypto.js';
/**
 * Generate a digest of the provided data.
 *
 * @param data The data to generate a digest of
 * @param algorithm A COSE algorithm ID that maps to a desired SHA algorithm
 */
export async function digest(data, algorithm) {
    const WebCrypto = await getWebCrypto();
    const subtleAlgorithm = mapCoseAlgToWebCryptoAlg(algorithm);
    const hashed = await WebCrypto.subtle.digest(subtleAlgorithm, data);
    return new Uint8Array(hashed);
}
