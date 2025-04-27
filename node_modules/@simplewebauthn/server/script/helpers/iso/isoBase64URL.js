"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.toBuffer = toBuffer;
exports.fromBuffer = fromBuffer;
exports.toBase64 = toBase64;
exports.fromUTF8String = fromUTF8String;
exports.toUTF8String = toUTF8String;
exports.isBase64 = isBase64;
exports.isBase64URL = isBase64URL;
exports.trimPadding = trimPadding;
/**
 * A runtime-agnostic collection of methods for working with Base64URL encoding
 * @module
 */
const base64_1 = __importDefault(require("@hexagon/base64"));
/**
 * Decode from a Base64URL-encoded string to an ArrayBuffer. Best used when converting a
 * credential ID from a JSON string to an ArrayBuffer, like in allowCredentials or
 * excludeCredentials.
 *
 * @param buffer Value to decode from base64
 * @param to (optional) The decoding to use, in case it's desirable to decode from base64 instead
 */
function toBuffer(base64urlString, from = 'base64url') {
    const _buffer = base64_1.default.toArrayBuffer(base64urlString, from === 'base64url');
    return new Uint8Array(_buffer);
}
/**
 * Encode the given array buffer into a Base64URL-encoded string. Ideal for converting various
 * credential response ArrayBuffers to string for sending back to the server as JSON.
 *
 * @param buffer Value to encode to base64
 * @param to (optional) The encoding to use, in case it's desirable to encode to base64 instead
 */
function fromBuffer(buffer, to = 'base64url') {
    return base64_1.default.fromArrayBuffer(buffer, to === 'base64url');
}
/**
 * Convert a base64url string into base64
 */
function toBase64(base64urlString) {
    const fromBase64Url = base64_1.default.toArrayBuffer(base64urlString, true);
    const toBase64 = base64_1.default.fromArrayBuffer(fromBase64Url);
    return toBase64;
}
/**
 * Encode a UTF-8 string to base64url
 */
function fromUTF8String(utf8String) {
    return base64_1.default.fromString(utf8String, true);
}
/**
 * Decode a base64url string into its original UTF-8 string
 */
function toUTF8String(base64urlString) {
    return base64_1.default.toString(base64urlString, true);
}
/**
 * Confirm that the string is encoded into base64
 */
function isBase64(input) {
    return base64_1.default.validate(input, false);
}
/**
 * Confirm that the string is encoded into base64url, with support for optional padding
 */
function isBase64URL(input) {
    // Trim padding characters from the string if present
    input = trimPadding(input);
    return base64_1.default.validate(input, true);
}
/**
 * Remove optional padding from a base64url-encoded string
 */
function trimPadding(input) {
    return input.replace(/=/g, '');
}
