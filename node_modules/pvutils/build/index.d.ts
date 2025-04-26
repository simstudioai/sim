/*!
 Copyright (c) Peculiar Ventures, LLC
*/

/**
 * Making UTC date from local date
 * @params date Date to convert from
 */
declare function getUTCDate(date: Date): Date;
/**
 * Get value for input parameters, or set a default value
 * @param parameters
 * @param name
 * @param defaultValue
 */
declare function getParametersValue<T = unknown>(parameters: Record<string, any>, name: string, defaultValue: T): T;
/**
 * Converts "ArrayBuffer" into a hexadecimal string
 * @param inputBuffer
 * @param inputOffset
 * @param inputLength
 * @param insertSpace
 */
declare function bufferToHexCodes(inputBuffer: ArrayBuffer, inputOffset?: number, inputLength?: number, insertSpace?: boolean): string;
interface LocalBaseBlock {
    error?: string;
}
/**
 * Check input "ArrayBuffer" for common functions
 * @param {LocalBaseBlock} baseBlock
 * @param {ArrayBuffer} inputBuffer
 * @param {number} inputOffset
 * @param {number} inputLength
 * @returns {boolean}
 */
declare function checkBufferParams(baseBlock: LocalBaseBlock, inputBuffer: ArrayBuffer, inputOffset: number, inputLength: number): boolean;
/**
 * Convert number from 2^base to 2^10
 * @param inputBuffer
 * @param inputBase
 */
declare function utilFromBase(inputBuffer: Uint8Array, inputBase: number): number;
/**
 * Convert number from 2^10 to 2^base
 * @param value The number to convert
 * @param base The base for 2^base
 * @param reserved Pre-defined number of bytes in output array (-1 = limited by function itself)
 */
declare function utilToBase(value: number, base: number, reserved?: number): ArrayBuffer;
/**
 * Concatenate two ArrayBuffers
 * @param buffers Set of ArrayBuffer
 */
declare function utilConcatBuf(...buffers: ArrayBuffer[]): ArrayBuffer;
/**
 * Concatenate two Uint8Array
 * @param  views Set of Uint8Array
 */
declare function utilConcatView(...views: Uint8Array[]): Uint8Array;
interface HexBlock {
    valueHex: ArrayBuffer;
    warnings: string[];
}
/**
 * Decoding of "two complement" values
 * The function must be called in scope of instance of "hexBlock" class ("valueHex" and "warnings" properties must be present)
 */
declare function utilDecodeTC(this: HexBlock): number;
/**
 * Encode integer value to "two complement" format
 * @param value Value to encode
 */
declare function utilEncodeTC(value: number): ArrayBuffer;
/**
 * Compare two array buffers
 * @param inputBuffer1
 * @param inputBuffer2
 */
declare function isEqualBuffer(inputBuffer1: ArrayBuffer, inputBuffer2: ArrayBuffer): boolean;
/**
 * Pad input number with leaded "0" if needed
 * @param inputNumber
 * @param fullLength
 */
declare function padNumber(inputNumber: number, fullLength: number): string;
/**
 * Encode string into BASE64 (or "base64url")
 * @param input
 * @param useUrlTemplate If "true" then output would be encoded using "base64url"
 * @param skipPadding Skip BASE-64 padding or not
 * @param skipLeadingZeros Skip leading zeros in input data or not
 */
declare function toBase64(input: string, useUrlTemplate?: boolean, skipPadding?: boolean, skipLeadingZeros?: boolean): string;
/**
 * Decode string from BASE64 (or "base64url")
 * @param input
 * @param useUrlTemplate If "true" then output would be encoded using "base64url"
 * @param cutTailZeros If "true" then cut tailing zeros from function result
 */
declare function fromBase64(input: string, useUrlTemplate?: boolean, cutTailZeros?: boolean): string;
declare function arrayBufferToString(buffer: ArrayBuffer): string;
declare function stringToArrayBuffer(str: string): ArrayBuffer;
/**
 * Get nearest to input length power of 2
 * @param length Current length of existing array
 */
declare function nearestPowerOf2(length: number): number;
/**
 * Delete properties by name from specified object
 * @param object Object to delete properties from
 * @param propsArray Array of properties names
 */
declare function clearProps(object: Record<string, any>, propsArray: string[]): void;

export { HexBlock, LocalBaseBlock, arrayBufferToString, bufferToHexCodes, checkBufferParams, clearProps, fromBase64, getParametersValue, getUTCDate, isEqualBuffer, nearestPowerOf2, padNumber, stringToArrayBuffer, toBase64, utilConcatBuf, utilConcatView, utilDecodeTC, utilEncodeTC, utilFromBase, utilToBase };
