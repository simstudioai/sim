import type { Base64URLString } from '../../types/index.js';
/**
 * Decode from a Base64URL-encoded string to an ArrayBuffer. Best used when converting a
 * credential ID from a JSON string to an ArrayBuffer, like in allowCredentials or
 * excludeCredentials.
 *
 * @param buffer Value to decode from base64
 * @param to (optional) The decoding to use, in case it's desirable to decode from base64 instead
 */
export declare function toBuffer(base64urlString: string, from?: 'base64' | 'base64url'): Uint8Array;
/**
 * Encode the given array buffer into a Base64URL-encoded string. Ideal for converting various
 * credential response ArrayBuffers to string for sending back to the server as JSON.
 *
 * @param buffer Value to encode to base64
 * @param to (optional) The encoding to use, in case it's desirable to encode to base64 instead
 */
export declare function fromBuffer(buffer: Uint8Array, to?: 'base64' | 'base64url'): string;
/**
 * Convert a base64url string into base64
 */
export declare function toBase64(base64urlString: string): string;
/**
 * Encode a UTF-8 string to base64url
 */
export declare function fromUTF8String(utf8String: string): string;
/**
 * Decode a base64url string into its original UTF-8 string
 */
export declare function toUTF8String(base64urlString: string): string;
/**
 * Confirm that the string is encoded into base64
 */
export declare function isBase64(input: string): boolean;
/**
 * Confirm that the string is encoded into base64url, with support for optional padding
 */
export declare function isBase64URL(input: string): boolean;
/**
 * Remove optional padding from a base64url-encoded string
 */
export declare function trimPadding(input: Base64URLString): Base64URLString;
//# sourceMappingURL=isoBase64URL.d.ts.map