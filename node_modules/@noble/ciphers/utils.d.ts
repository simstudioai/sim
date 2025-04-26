export type TypedArray = Int8Array | Uint8ClampedArray | Uint8Array | Uint16Array | Int16Array | Uint32Array | Int32Array;
export declare const u8: (arr: TypedArray) => Uint8Array;
export declare const u16: (arr: TypedArray) => Uint16Array;
export declare const u32: (arr: TypedArray) => Uint32Array;
export declare const createView: (arr: TypedArray) => DataView;
export declare const isLE: boolean;
/**
 * @example bytesToHex(Uint8Array.from([0xca, 0xfe, 0x01, 0x23])) // 'cafe0123'
 */
export declare function bytesToHex(bytes: Uint8Array): string;
/**
 * @example hexToBytes('cafe0123') // Uint8Array.from([0xca, 0xfe, 0x01, 0x23])
 */
export declare function hexToBytes(hex: string): Uint8Array;
export declare function hexToNumber(hex: string): bigint;
export declare function bytesToNumberBE(bytes: Uint8Array): bigint;
export declare function numberToBytesBE(n: number | bigint, len: number): Uint8Array;
export declare const nextTick: () => Promise<void>;
export declare function asyncLoop(iters: number, tick: number, cb: (i: number) => void): Promise<void>;
/**
 * @example utf8ToBytes('abc') // new Uint8Array([97, 98, 99])
 */
export declare function utf8ToBytes(str: string): Uint8Array;
/**
 * @example bytesToUtf8(new Uint8Array([97, 98, 99])) // 'abc'
 */
export declare function bytesToUtf8(bytes: Uint8Array): string;
export type Input = Uint8Array | string;
/**
 * Normalizes (non-hex) string or Uint8Array to Uint8Array.
 * Warning: when Uint8Array is passed, it would NOT get copied.
 * Keep in mind for future mutable operations.
 */
export declare function toBytes(data: Input): Uint8Array;
/**
 * Copies several Uint8Arrays into one.
 */
export declare function concatBytes(...arrays: Uint8Array[]): Uint8Array;
type EmptyObj = {};
export declare function checkOpts<T1 extends EmptyObj, T2 extends EmptyObj>(defaults: T1, opts: T2): T1 & T2;
export declare function equalBytes(a: Uint8Array, b: Uint8Array): boolean;
export declare abstract class Hash<T extends Hash<T>> {
    abstract blockLen: number;
    abstract outputLen: number;
    abstract update(buf: Input): this;
    abstract digestInto(buf: Uint8Array): void;
    abstract digest(): Uint8Array;
    /**
     * Resets internal state. Makes Hash instance unusable.
     * Reset is impossible for keyed hashes if key is consumed into state. If digest is not consumed
     * by user, they will need to manually call `destroy()` when zeroing is necessary.
     */
    abstract destroy(): void;
}
export type Cipher = {
    encrypt(plaintext: Uint8Array): Uint8Array;
    decrypt(ciphertext: Uint8Array): Uint8Array;
};
export type AsyncCipher = {
    encrypt(plaintext: Uint8Array): Promise<Uint8Array>;
    decrypt(ciphertext: Uint8Array): Promise<Uint8Array>;
};
export type CipherWithOutput = Cipher & {
    encrypt(plaintext: Uint8Array, output?: Uint8Array): Uint8Array;
    decrypt(ciphertext: Uint8Array, output?: Uint8Array): Uint8Array;
};
export type CipherParams = {
    blockSize: number;
    nonceLength?: number;
    tagLength?: number;
};
export type CipherCons<T extends any[]> = (key: Uint8Array, ...args: T) => Cipher;
/**
 * @__NO_SIDE_EFFECTS__
 */
export declare const wrapCipher: <C extends CipherCons<any>, P extends CipherParams>(params: P, c: C) => C & P;
export type XorStream = (key: Uint8Array, nonce: Uint8Array, data: Uint8Array, output?: Uint8Array, counter?: number) => Uint8Array;
export declare function setBigUint64(view: DataView, byteOffset: number, value: bigint, isLE: boolean): void;
export declare function u64Lengths(ciphertext: Uint8Array, AAD?: Uint8Array): Uint8Array;
export declare function isAligned32(bytes: Uint8Array): boolean;
export declare function copyBytes(bytes: Uint8Array): Uint8Array;
export declare function clean(...arrays: TypedArray[]): void;
export {};
//# sourceMappingURL=utils.d.ts.map