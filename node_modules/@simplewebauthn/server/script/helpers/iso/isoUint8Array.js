"use strict";
/**
 * A runtime-agnostic collection of methods for working with Uint8Arrays
 * @module
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.areEqual = areEqual;
exports.toHex = toHex;
exports.fromHex = fromHex;
exports.concat = concat;
exports.toUTF8String = toUTF8String;
exports.fromUTF8String = fromUTF8String;
exports.fromASCIIString = fromASCIIString;
exports.toDataView = toDataView;
/**
 * Make sure two Uint8Arrays are deeply equivalent
 */
function areEqual(array1, array2) {
    if (array1.length != array2.length) {
        return false;
    }
    return array1.every((val, i) => val === array2[i]);
}
/**
 * Convert a Uint8Array to Hexadecimal.
 *
 * A replacement for `Buffer.toString('hex')`
 */
function toHex(array) {
    const hexParts = Array.from(array, (i) => i.toString(16).padStart(2, '0'));
    // adce000235bcc60a648b0b25f1f05503
    return hexParts.join('');
}
/**
 * Convert a hexadecimal string to isoUint8Array.
 *
 * A replacement for `Buffer.from('...', 'hex')`
 */
function fromHex(hex) {
    if (!hex) {
        return Uint8Array.from([]);
    }
    const isValid = hex.length !== 0 && hex.length % 2 === 0 &&
        !/[^a-fA-F0-9]/u.test(hex);
    if (!isValid) {
        throw new Error('Invalid hex string');
    }
    const byteStrings = hex.match(/.{1,2}/g) ?? [];
    return Uint8Array.from(byteStrings.map((byte) => parseInt(byte, 16)));
}
/**
 * Combine multiple Uint8Arrays into a single Uint8Array
 */
function concat(arrays) {
    let pointer = 0;
    const totalLength = arrays.reduce((prev, curr) => prev + curr.length, 0);
    const toReturn = new Uint8Array(totalLength);
    arrays.forEach((arr) => {
        toReturn.set(arr, pointer);
        pointer += arr.length;
    });
    return toReturn;
}
/**
 * Convert bytes into a UTF-8 string
 */
function toUTF8String(array) {
    const decoder = new globalThis.TextDecoder('utf-8');
    return decoder.decode(array);
}
/**
 * Convert a UTF-8 string back into bytes
 */
function fromUTF8String(utf8String) {
    const encoder = new globalThis.TextEncoder();
    return encoder.encode(utf8String);
}
/**
 * Convert an ASCII string to Uint8Array
 */
function fromASCIIString(value) {
    return Uint8Array.from(value.split('').map((x) => x.charCodeAt(0)));
}
/**
 * Prepare a DataView we can slice our way around in as we parse the bytes in a Uint8Array
 */
function toDataView(array) {
    return new DataView(array.buffer, array.byteOffset, array.length);
}
