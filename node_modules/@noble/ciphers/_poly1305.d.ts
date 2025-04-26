import { Hash, Input } from './utils.js';
export type CHash = ReturnType<typeof wrapConstructorWithKey>;
export declare function wrapConstructorWithKey<H extends Hash<H>>(hashCons: (key: Input) => Hash<H>): {
    (msg: Input, key: Input): Uint8Array;
    outputLen: number;
    blockLen: number;
    create(key: Input): Hash<H>;
};
export declare const poly1305: {
    (msg: Input, key: Input): Uint8Array;
    outputLen: number;
    blockLen: number;
    create(key: Input): Hash<Hash<unknown>>;
};
//# sourceMappingURL=_poly1305.d.ts.map