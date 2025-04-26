/*!
 * MIT License
 * 
 * Copyright (c) 2017-2024 Peculiar Ventures, LLC
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 * 
 */

type BufferSource = ArrayBuffer | ArrayBufferView;
interface ArrayBufferViewConstructor<T extends ArrayBufferView> {
    readonly prototype: T;
    new (length: number): T;
    new (array: ArrayLike<number> | ArrayBufferLike): T;
    new (buffer: ArrayBufferLike, byteOffset?: number, length?: number): T;
}
declare class BufferSourceConverter {
    /**
     * Checks if incoming data is ArrayBuffer
     * @param data Data to be checked
     * @returns Returns `true` if incoming data is ArrayBuffer, otherwise `false`
     */
    static isArrayBuffer(data: any): data is ArrayBuffer;
    /**
     * Converts incoming buffer source into ArrayBuffer
     * @param data Buffer source
     * @returns ArrayBuffer representation of data
     * @remarks If incoming data is ArrayBuffer then it returns it without copying,
     * otherwise it copies data into new ArrayBuffer because incoming data can be
     * ArrayBufferView with offset and length which is not equal to buffer length
     */
    static toArrayBuffer(data: BufferSource): ArrayBuffer;
    /**
     * Converts incoming buffer source into Uint8Array
     * @param data Buffer source
     * @returns Uint8Array representation of data
     */
    static toUint8Array(data: BufferSource): Uint8Array;
    /**
     * Converts a given `BufferSource` to the specified `ArrayBufferView` type.
     * @param data The `BufferSource` to convert.
     * @param type The `ArrayBufferView` constructor to use for the conversion.
     * @returns The converted `ArrayBufferView`.
     * @throws {TypeError} If the provided value is not of type `(ArrayBuffer or ArrayBufferView)`.
     * @remarks If incoming data is ArrayBufferView and it's type is equal to specified type
     * then it returns it without copying, otherwise it copies data into new ArrayBufferView
     * because incoming data can be ArrayBufferView with offset and length which is not equal
     * to buffer length
     */
    static toView<T extends ArrayBufferView>(data: BufferSource, type: ArrayBufferViewConstructor<T>): T;
    /**
     * Checks if incoming data is BufferSource
     * @param data Data to be checked
     * @returns Returns `true` if incoming data is BufferSource, otherwise `false`
     */
    static isBufferSource(data: any): data is BufferSource;
    /**
     * Checks if incoming data is ArraybufferView
     * @param data Data to be checked
     * @returns Returns `true` if incoming data is ArraybufferView, otherwise `false`
     */
    static isArrayBufferView(data: any): data is ArrayBufferView;
    /**
     * Checks if buffers are equal
     * @param a Buffer source
     * @param b Buffer source
     * @returns Returns `true` if buffers are equal, otherwise `false`
     */
    static isEqual(a: BufferSource, b: BufferSource): boolean;
    /**
     * Concatenates buffers
     * @param buffers List of buffers
     * @returns Concatenated buffer
     */
    static concat(...buffers: BufferSource[]): ArrayBuffer;
    /**
     * Concatenates buffers
     * @param buffers List of buffers
     * @returns Concatenated buffer
     */
    static concat(buffers: BufferSource[]): ArrayBuffer;
    /**
     * Concatenates buffers and converts it into specified ArrayBufferView
     * @param buffers List of buffers
     * @param type ArrayBufferView constructor
     * @returns Concatenated buffer of specified type
     */
    static concat<T extends ArrayBufferView>(buffers: BufferSource[], type: ArrayBufferViewConstructor<T>): T;
}

type BufferEncoding = "utf8" | "binary" | "base64" | "base64url" | "hex" | string;
type TextEncoding = "ascii" | "utf8" | "utf16" | "utf16be" | "utf16le" | "usc2";
declare class Convert {
    static isHex(data: any): data is string;
    static isBase64(data: any): data is string;
    static isBase64Url(data: any): data is string;
    static ToString(buffer: BufferSource, enc?: BufferEncoding): string;
    static FromString(str: string, enc?: BufferEncoding): ArrayBuffer;
    /**
     * Converts byte array to Base64 encoded string.
     * @param buffer - Byte array to encode.
     * @returns Base64 string.
     */
    static ToBase64(buffer: BufferSource): string;
    /**
     * Converts byte array to Base64 encoded string.
     * @param base64 - Base64 encoded string.
     * @returns Byte array.
     */
    static FromBase64(base64: string): ArrayBuffer;
    /**
     * Converts Base64Url encoded string to byte array.
     * @param base64url - Base64Url encoded string.
     * @returns Byte array.
     */
    static FromBase64Url(base64url: string): ArrayBuffer;
    /**
     * Converts byte array to Base64Url encoded string.
     * @param data - Byte array to encode.
     * @returns Base64Url encoded string.
     */
    static ToBase64Url(data: BufferSource): string;
    protected static DEFAULT_UTF8_ENCODING: TextEncoding;
    /**
     * Converts JavaScript string to ArrayBuffer using specified encoding.
     * @param text - JavaScript string to convert.
     * @param encoding - Encoding to use. Default is 'utf8'.
     * @returns ArrayBuffer representing input string.
     */
    static FromUtf8String(text: string, encoding?: TextEncoding): ArrayBuffer;
    /**
     * Converts ArrayBuffer to JavaScript string using specified encoding.
     * @param buffer - Buffer to convert.
     * @param encoding - Encoding to use. Default is 'utf8'.
     * @returns JavaScript string derived from input buffer.
     */
    static ToUtf8String(buffer: BufferSource, encoding?: TextEncoding): string;
    /**
     * Converts binary string to ArrayBuffer.
     * @param text - Binary string.
     * @returns Byte array.
     */
    static FromBinary(text: string): ArrayBuffer;
    /**
     * Converts buffer to binary string.
     * @param buffer - Input buffer.
     * @returns Binary string.
     */
    static ToBinary(buffer: BufferSource): string;
    /**
     * Converts buffer to HEX string
     * @param  {BufferSource} buffer Incoming buffer
     * @returns string
     */
    static ToHex(buffer: BufferSource): string;
    /**
     * Converts HEX string to buffer
     *
     * @static
     * @param {string} formatted
     * @returns {Uint8Array}
     *
     * @memberOf Convert
     */
    static FromHex(hexString: string): ArrayBuffer;
    /**
     * Converts UTF-16 encoded buffer to UTF-8 string
     * @param buffer UTF-16 encoded buffer
     * @param littleEndian Indicates whether the char code is stored in little- or big-endian format
     * @returns UTF-8 string
     */
    static ToUtf16String(buffer: BufferSource, littleEndian?: boolean): string;
    /**
     * Converts UTF-8 string to UTF-16 encoded buffer
     * @param text UTF-8 string
     * @param littleEndian Indicates whether the char code is stored in little- or big-endian format
     * @returns UTF-16 encoded buffer
     */
    static FromUtf16String(text: string, littleEndian?: boolean): ArrayBuffer;
    protected static Base64Padding(base64: string): string;
    /**
     * Removes odd chars from string data
     * @param data String data
     */
    static formatString(data: string): string;
}

declare function assign(target: any, ...sources: any[]): any;
declare function combine(...buf: ArrayBuffer[]): ArrayBufferLike;
declare function isEqual(bytes1: ArrayBuffer, bytes2: ArrayBuffer): boolean;

export { type ArrayBufferViewConstructor, type BufferEncoding, type BufferSource, BufferSourceConverter, Convert, type TextEncoding, assign, combine, isEqual };
