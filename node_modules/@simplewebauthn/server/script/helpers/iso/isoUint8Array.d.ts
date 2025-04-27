/**
 * A runtime-agnostic collection of methods for working with Uint8Arrays
 * @module
 */
/**
 * Make sure two Uint8Arrays are deeply equivalent
 */
export declare function areEqual(array1: Uint8Array, array2: Uint8Array): boolean;
/**
 * Convert a Uint8Array to Hexadecimal.
 *
 * A replacement for `Buffer.toString('hex')`
 */
export declare function toHex(array: Uint8Array): string;
/**
 * Convert a hexadecimal string to isoUint8Array.
 *
 * A replacement for `Buffer.from('...', 'hex')`
 */
export declare function fromHex(hex: string): Uint8Array;
/**
 * Combine multiple Uint8Arrays into a single Uint8Array
 */
export declare function concat(arrays: Uint8Array[]): Uint8Array;
/**
 * Convert bytes into a UTF-8 string
 */
export declare function toUTF8String(array: Uint8Array): string;
/**
 * Convert a UTF-8 string back into bytes
 */
export declare function fromUTF8String(utf8String: string): Uint8Array;
/**
 * Convert an ASCII string to Uint8Array
 */
export declare function fromASCIIString(value: string): Uint8Array;
/**
 * Prepare a DataView we can slice our way around in as we parse the bytes in a Uint8Array
 */
export declare function toDataView(array: Uint8Array): DataView;
//# sourceMappingURL=isoUint8Array.d.ts.map