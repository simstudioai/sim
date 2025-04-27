import { getWebCrypto } from './getWebCrypto.js';
export async function importKey(opts) {
    const WebCrypto = await getWebCrypto();
    const { keyData, algorithm } = opts;
    return WebCrypto.subtle.importKey('jwk', keyData, algorithm, false, [
        'verify',
    ]);
}
