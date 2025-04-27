import { Hash, Input } from './utils.js';
/**
 * `mulX_POLYVAL(ByteReverse(H))` from spec
 * @param k mutated in place
 */
export declare function _toGHASHKey(k: Uint8Array): Uint8Array;
export type CHash = ReturnType<typeof wrapConstructorWithKey>;
declare function wrapConstructorWithKey<H extends Hash<H>>(hashCons: (key: Input, expectedLength?: number) => Hash<H>): {
    (msg: Input, key: Input): Uint8Array;
    outputLen: number;
    blockLen: number;
    create(key: Input, expectedLength?: number): Hash<H>;
};
export declare const ghash: {
    (msg: Input, key: Input): Uint8Array;
    outputLen: number;
    blockLen: number;
    create(key: Input, expectedLength?: number): Hash<Hash<unknown>>;
};
export declare const polyval: {
    (msg: Input, key: Input): Uint8Array;
    outputLen: number;
    blockLen: number;
    create(key: Input, expectedLength?: number): Hash<Hash<unknown>>;
};
export {};
//# sourceMappingURL=_polyval.d.ts.map