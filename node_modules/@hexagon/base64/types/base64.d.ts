export default base64;
export namespace base64 {
    /**
     * Convenience function for converting a base64 encoded string to an ArrayBuffer instance
     * @public
     *
     * @param {string} data - Base64 representation of data
     * @param {boolean} [urlMode] - If set to true, URL mode string will be expected
     * @returns {ArrayBuffer} - Decoded data
     */
    export function toArrayBuffer(data: string, urlMode?: boolean): ArrayBuffer;
    /**
     * Convenience function for creating a base64 encoded string from an ArrayBuffer instance
     * @public
     *
     * @param {ArrayBuffer} arrBuf - ArrayBuffer to be encoded
     * @param {boolean} [urlMode] - If set to true, URL mode string will be returned
     * @returns {string} - Base64 representation of data
     */
    export function fromArrayBuffer(arrBuf: ArrayBuffer, urlMode?: boolean): string;
    /**
     * Convenience function for converting base64 to string
     * @public
     *
     * @param {string} str - Base64 encoded string to be decoded
     * @param {boolean} [urlMode] - If set to true, URL mode string will be expected
     * @returns {string} - Decoded string
     */
    export function toString(str: string, urlMode?: boolean): string;
    /**
     * Convenience function for converting a javascript string to base64
     * @public
     *
     * @param {string} str - String to be converted to base64
     * @param {boolean} [urlMode] - If set to true, URL mode string will be returned
     * @returns {string} - Base64 encoded string
     */
    export function fromString(str: string, urlMode?: boolean): string;
    /**
     * Function to validate base64
     * @public
     * @param {string} encoded - Base64 or Base64url encoded data
     * @param {boolean} [urlMode] - If set to true, base64url will be expected
     * @returns {boolean} - Valid base64/base64url?
     */
    export function validate(encoded: string, urlMode?: boolean): boolean;
    export { base64 };
}
