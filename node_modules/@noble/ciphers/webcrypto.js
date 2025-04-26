"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gcm = exports.ctr = exports.cbc = exports.utils = void 0;
exports.randomBytes = randomBytes;
exports.getWebcryptoSubtle = getWebcryptoSubtle;
exports.managedNonce = managedNonce;
// We use WebCrypto aka globalThis.crypto, which exists in browsers and node.js 16+.
// node.js versions earlier than v19 don't declare it in global scope.
// For node.js, package.js on#exports field mapping rewrites import
// from `crypto` to `cryptoNode`, which imports native module.
// Makes the utils un-importable in browsers without a bundler.
// Once node.js 18 is deprecated, we can just drop the import.
//
// Use full path so that Node.js can rewrite it to `cryptoNode.js`.
const crypto_1 = require("@noble/ciphers/crypto");
const _assert_js_1 = require("./_assert.js");
const utils_js_1 = require("./utils.js");
/**
 * Secure PRNG. Uses `crypto.getRandomValues`, which defers to OS.
 */
function randomBytes(bytesLength = 32) {
    if (crypto_1.crypto && typeof crypto_1.crypto.getRandomValues === 'function')
        return crypto_1.crypto.getRandomValues(new Uint8Array(bytesLength));
    throw new Error('crypto.getRandomValues must be defined');
}
function getWebcryptoSubtle() {
    if (crypto_1.crypto && typeof crypto_1.crypto.subtle === 'object' && crypto_1.crypto.subtle != null)
        return crypto_1.crypto.subtle;
    throw new Error('crypto.subtle must be defined');
}
// Uses CSPRG for nonce, nonce injected in ciphertext
function managedNonce(fn) {
    (0, _assert_js_1.number)(fn.nonceLength);
    return ((key, ...args) => ({
        encrypt(plaintext, ...argsEnc) {
            const { nonceLength } = fn;
            const nonce = randomBytes(nonceLength);
            const ciphertext = fn(key, nonce, ...args).encrypt(plaintext, ...argsEnc);
            const out = (0, utils_js_1.concatBytes)(nonce, ciphertext);
            ciphertext.fill(0);
            return out;
        },
        decrypt(ciphertext, ...argsDec) {
            const { nonceLength } = fn;
            const nonce = ciphertext.subarray(0, nonceLength);
            const data = ciphertext.subarray(nonceLength);
            return fn(key, nonce, ...args).decrypt(data, ...argsDec);
        },
    }));
}
// Overridable
exports.utils = {
    async encrypt(key, keyParams, cryptParams, plaintext) {
        const cr = getWebcryptoSubtle();
        const iKey = await cr.importKey('raw', key, keyParams, true, ['encrypt']);
        const ciphertext = await cr.encrypt(cryptParams, iKey, plaintext);
        return new Uint8Array(ciphertext);
    },
    async decrypt(key, keyParams, cryptParams, ciphertext) {
        const cr = getWebcryptoSubtle();
        const iKey = await cr.importKey('raw', key, keyParams, true, ['decrypt']);
        const plaintext = await cr.decrypt(cryptParams, iKey, ciphertext);
        return new Uint8Array(plaintext);
    },
};
const mode = {
    CBC: 'AES-CBC',
    CTR: 'AES-CTR',
    GCM: 'AES-GCM',
};
function getCryptParams(algo, nonce, AAD) {
    if (algo === mode.CBC)
        return { name: mode.CBC, iv: nonce };
    if (algo === mode.CTR)
        return { name: mode.CTR, counter: nonce, length: 64 };
    if (algo === mode.GCM) {
        if (AAD)
            return { name: mode.GCM, iv: nonce, additionalData: AAD };
        else
            return { name: mode.GCM, iv: nonce };
    }
    throw new Error('unknown aes block mode');
}
function generate(algo) {
    return (key, nonce, AAD) => {
        (0, _assert_js_1.bytes)(key);
        (0, _assert_js_1.bytes)(nonce);
        const keyParams = { name: algo, length: key.length * 8 };
        const cryptParams = getCryptParams(algo, nonce, AAD);
        return {
            // keyLength,
            encrypt(plaintext) {
                (0, _assert_js_1.bytes)(plaintext);
                return exports.utils.encrypt(key, keyParams, cryptParams, plaintext);
            },
            decrypt(ciphertext) {
                (0, _assert_js_1.bytes)(ciphertext);
                return exports.utils.decrypt(key, keyParams, cryptParams, ciphertext);
            },
        };
    };
}
exports.cbc = generate(mode.CBC);
exports.ctr = generate(mode.CTR);
exports.gcm = generate(mode.GCM);
// // Type tests
// import { siv, gcm, ctr, ecb, cbc } from '../aes.js';
// import { xsalsa20poly1305 } from '../salsa.js';
// import { chacha20poly1305, xchacha20poly1305 } from '../chacha.js';
// const wsiv = managedNonce(siv);
// const wgcm = managedNonce(gcm);
// const wctr = managedNonce(ctr);
// const wcbc = managedNonce(cbc);
// const wsalsapoly = managedNonce(xsalsa20poly1305);
// const wchacha = managedNonce(chacha20poly1305);
// const wxchacha = managedNonce(xchacha20poly1305);
// // should fail
// const wcbc2 = managedNonce(managedNonce(cbc));
// const wctr = managedNonce(ctr);
//# sourceMappingURL=webcrypto.js.map