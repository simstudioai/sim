/**
 * A runtime-agnostic collection of methods for working with CBOR encoding
 * @module
 */
import * as tinyCbor from '@levischuck/tiny-cbor';
/**
 * Whatever CBOR encoder is used should keep CBOR data the same length when data is re-encoded
 *
 * MOST CRITICALLY, this means the following needs to be true of whatever CBOR library we use:
 * - CBOR Map type values MUST decode to JavaScript Maps
 * - CBOR tag 64 (uint8 Typed Array) MUST NOT be used when encoding Uint8Arrays back to CBOR
 *
 * So long as these requirements are maintained, then CBOR sequences can be encoded and decoded
 * freely while maintaining their lengths for the most accurate pointer movement across them.
 */
/**
 * Decode and return the first item in a sequence of CBOR-encoded values
 *
 * @param input The CBOR data to decode
 * @param asObject (optional) Whether to convert any CBOR Maps into JavaScript Objects. Defaults to
 * `false`
 */
export function decodeFirst(input) {
    // Make a copy so we don't mutate the original
    const _input = new Uint8Array(input);
    const decoded = tinyCbor.decodePartialCBOR(_input, 0);
    const [first] = decoded;
    return first;
}
/**
 * Encode data to CBOR
 */
export function encode(input) {
    return tinyCbor.encodeCBOR(input);
}
