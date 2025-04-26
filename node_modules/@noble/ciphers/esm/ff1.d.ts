import { Cipher } from './utils.js';
export declare function FF1(radix: number, key: Uint8Array, tweak?: Uint8Array): {
    encrypt(x: number[]): number[];
    decrypt(x: number[]): number[];
};
export declare function BinaryFF1(key: Uint8Array, tweak?: Uint8Array): Cipher;
//# sourceMappingURL=ff1.d.ts.map