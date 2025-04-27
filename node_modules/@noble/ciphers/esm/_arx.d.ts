import { XorStream } from './utils.js';
export declare const sigma: Uint32Array;
export declare function rotl(a: number, b: number): number;
export type CipherCoreFn = (sigma: Uint32Array, key: Uint32Array, nonce: Uint32Array, output: Uint32Array, counter: number, rounds?: number) => void;
export type ExtendNonceFn = (sigma: Uint32Array, key: Uint32Array, input: Uint32Array, output: Uint32Array) => void;
export type CipherOpts = {
    allowShortKeys?: boolean;
    extendNonceFn?: ExtendNonceFn;
    counterLength?: number;
    counterRight?: boolean;
    rounds?: number;
};
export declare function createCipher(core: CipherCoreFn, opts: CipherOpts): XorStream;
//# sourceMappingURL=_arx.d.ts.map