/**
 * A value which is wrapped with a CBOR Tag.
 * Several tags are registered with defined meanings like 0 for a date string.
 * These meanings are **not interpreted** when decoded or encoded.
 *
 * This class is an immutable record.
 * If the tag number or value needs to change, then construct a new tag
 */
export declare class CBORTag {
    private tagId;
    private tagValue;
    /**
     * Wrap a value with a tag number.
     * When encoded, this tag will be attached to the value.
     *
     * @param tag Tag number
     * @param value Wrapped value
     */
    constructor(tag: number, value: CBORType);
    /**
     * Read the tag number
     */
    get tag(): number;
    /**
     * Read the value
     */
    get value(): CBORType;
}
/**
 * Supported types which are encodable and decodable with tiny CBOR.
 * Note that plain javascript objects are omitted.
 */
export type CBORType = number | bigint | string | Uint8Array | boolean | null | undefined | CBORType[] | CBORTag | Map<string | number, CBORType>;
/**
 * Like {decodeCBOR}, but the length of the data is unknown and there is likely
 * more -- possibly unrelated non-CBOR -- data afterwards.
 *
 * Examples:
 *
 * ```ts
 * import {decodePartialCBOR} from './cbor.ts'
 * decodePartialCBOR(new Uint8Array([1, 2, 245, 3, 4]), 2)
 * // returns [true, 1]
 * // It did not decode the leading [1, 2] or trailing [3, 4]
 * ```
 *
 * @param data a data stream to read data from
 * @param index where to start reading in the data stream
 * @returns a tuple of the value followed by bytes read.
 * @throws {Error}
 *   When the data stream ends early or the CBOR data is not well formed
 */
export declare function decodePartialCBOR(data: DataView | Uint8Array | ArrayBuffer, index: number): [CBORType, number];
/**
 * Decode CBOR data from a binary stream
 *
 * The entire data stream from [0, length) will be consumed.
 * If you require a partial decoding, see {decodePartialCBOR}.
 *
 * Examples:
 *
 * ```ts
 * import {decodeCBOR, CBORTag, CBORType} from './cbor.ts'
 * decodeCBOR(new Uint8Array([162, 99, 107, 101, 121, 101, 118, 97, 108, 117, 101, 1, 109, 97, 110, 111, 116, 104, 101, 114, 32, 118, 97, 108, 117, 101]));
 * // returns new Map<string | number, CBORType>([
 * //   ["key", "value"],
 * //   [1, "another value"]
 * // ]);
 *
 * const taggedItem = new Uint8Array([217, 4, 210, 101, 104, 101, 108, 108, 111]);
 * decodeCBOR(new DataView(taggedItem.buffer))
 * // returns new CBORTag(1234, "hello")
 * ```
 *
 * @param data a data stream, multiple types are supported
 * @returns
 */
export declare function decodeCBOR(data: DataView | Uint8Array | ArrayBuffer): CBORType;
/**
 * Encode a supported structure to a CBOR byte string.
 *
 * Example:
 *
 * ```ts
 * import {encodeCBOR, CBORType, CBORTag} from './cbor.ts'
 * encodeCBOR(new Map<string | number, CBORType>([
 *   ["key", "value"],
 *   [1, "another value"]
 * ]));
 * // returns new Uint8Array([162, 99, 107, 101, 121, 101, 118, 97, 108, 117, 101, 1, 109, 97, 110, 111, 116, 104, 101, 114, 32 118, 97, 108, 117, 101])
 *
 * encodeCBOR(new CBORTag(1234, "hello"))
 * // returns new UInt8Array([217, 4, 210, 101, 104, 101, 108, 108, 111])
 * ```
 *
 * @param data Data to encode
 * @returns A byte string as a Uint8Array
 * @throws Error
 *   if unsupported data is found during encoding
 */
export declare function encodeCBOR(data: CBORType): Uint8Array;
