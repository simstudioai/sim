"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._parseAuthenticatorDataInternals = void 0;
exports.parseAuthenticatorData = parseAuthenticatorData;
const decodeAuthenticatorExtensions_js_1 = require("./decodeAuthenticatorExtensions.js");
const index_js_1 = require("./iso/index.js");
/**
 * Make sense of the authData buffer contained in an Attestation
 */
function parseAuthenticatorData(authData) {
    if (authData.byteLength < 37) {
        throw new Error(`Authenticator data was ${authData.byteLength} bytes, expected at least 37 bytes`);
    }
    let pointer = 0;
    const dataView = index_js_1.isoUint8Array.toDataView(authData);
    const rpIdHash = authData.slice(pointer, pointer += 32);
    const flagsBuf = authData.slice(pointer, pointer += 1);
    const flagsInt = flagsBuf[0];
    // Bit positions can be referenced here:
    // https://www.w3.org/TR/webauthn-2/#flags
    const flags = {
        up: !!(flagsInt & (1 << 0)), // User Presence
        uv: !!(flagsInt & (1 << 2)), // User Verified
        be: !!(flagsInt & (1 << 3)), // Backup Eligibility
        bs: !!(flagsInt & (1 << 4)), // Backup State
        at: !!(flagsInt & (1 << 6)), // Attested Credential Data Present
        ed: !!(flagsInt & (1 << 7)), // Extension Data Present
        flagsInt,
    };
    const counterBuf = authData.slice(pointer, pointer + 4);
    const counter = dataView.getUint32(pointer, false);
    pointer += 4;
    let aaguid = undefined;
    let credentialID = undefined;
    let credentialPublicKey = undefined;
    if (flags.at) {
        aaguid = authData.slice(pointer, pointer += 16);
        const credIDLen = dataView.getUint16(pointer);
        pointer += 2;
        credentialID = authData.slice(pointer, pointer += credIDLen);
        /**
         * Firefox 117 incorrectly CBOR-encodes authData when EdDSA (-8) is used for the public key.
         * A CBOR "Map of 3 items" (0xa3) should be "Map of 4 items" (0xa4), and if we manually adjust
         * the single byte there's a good chance the authData can be correctly parsed.
         *
         * This browser release also incorrectly uses the string labels "OKP" and "Ed25519" instead of
         * their integer representations for kty and crv respectively. That's why the COSE public key
         * in the hex below looks so odd.
         */
        // Bytes decode to `{ 1: "OKP", 3: -8, -1: "Ed25519" }` (it's missing key -2 a.k.a. COSEKEYS.x)
        const badEdDSACBOR = index_js_1.isoUint8Array.fromHex('a301634f4b500327206745643235353139');
        const bytesAtCurrentPosition = authData.slice(pointer, pointer + badEdDSACBOR.byteLength);
        let foundBadCBOR = false;
        if (index_js_1.isoUint8Array.areEqual(badEdDSACBOR, bytesAtCurrentPosition)) {
            // Change the bad CBOR 0xa3 to 0xa4 so that the credential public key can be recognized
            foundBadCBOR = true;
            authData[pointer] = 0xa4;
        }
        // Decode the next CBOR item in the buffer, then re-encode it back to a Buffer
        const firstDecoded = index_js_1.isoCBOR.decodeFirst(authData.slice(pointer));
        const firstEncoded = Uint8Array.from(
        /**
         * Casting to `Map` via `as unknown` here because TS doesn't make it possible to define Maps
         * with discrete keys and properties with known types per pair, and CBOR libs typically parse
         * CBOR Major Type 5 to `Map` because you can have numbers for keys. A `COSEPublicKey` can be
         * generalized as "a Map with numbers for keys and either numbers or bytes for values" though.
         * If this presumption falls apart then other parts of verification later on will fail so we
         * should be safe doing this here.
         */
        index_js_1.isoCBOR.encode(firstDecoded));
        if (foundBadCBOR) {
            // Restore the bit we changed so that `authData` is the same as it came in and won't break
            // signature verification.
            authData[pointer] = 0xa3;
        }
        credentialPublicKey = firstEncoded;
        pointer += firstEncoded.byteLength;
    }
    let extensionsData = undefined;
    let extensionsDataBuffer = undefined;
    if (flags.ed) {
        const firstDecoded = index_js_1.isoCBOR.decodeFirst(authData.slice(pointer));
        extensionsDataBuffer = Uint8Array.from(index_js_1.isoCBOR.encode(firstDecoded));
        extensionsData = (0, decodeAuthenticatorExtensions_js_1.decodeAuthenticatorExtensions)(extensionsDataBuffer);
        pointer += extensionsDataBuffer.byteLength;
    }
    // Pointer should be at the end of the authenticator data, otherwise too much data was sent
    if (authData.byteLength > pointer) {
        throw new Error('Leftover bytes detected while parsing authenticator data');
    }
    return exports._parseAuthenticatorDataInternals.stubThis({
        rpIdHash,
        flagsBuf,
        flags,
        counter,
        counterBuf,
        aaguid,
        credentialID,
        credentialPublicKey,
        extensionsData,
        extensionsDataBuffer,
    });
}
/**
 * Make it possible to stub the return value during testing
 * @ignore Don't include this in docs output
 */
exports._parseAuthenticatorDataInternals = {
    stubThis: (value) => value,
};
