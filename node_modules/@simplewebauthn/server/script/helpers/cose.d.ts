/**
 * Fundamental values that are needed to discern the more specific COSE public key types below.
 *
 * The use of `Maps` here is due to CBOR encoding being used with public keys, and the CBOR "Map"
 * type is being decoded to JavaScript's `Map` type instead of, say, a basic Object as us JS
 * developers might prefer.
 *
 * These types are an unorthodox way of saying "these Maps should involve these discrete lists of
 * keys", but it works.
 * @module
 */
/**
 * COSE public key common values
 */
export type COSEPublicKey = {
    get(key: COSEKEYS.kty): COSEKTY | undefined;
    get(key: COSEKEYS.alg): COSEALG | undefined;
    set(key: COSEKEYS.kty, value: COSEKTY): void;
    set(key: COSEKEYS.alg, value: COSEALG): void;
};
/**
 * Values specific to Octet Key Pair public keys
 */
export type COSEPublicKeyOKP = COSEPublicKey & {
    get(key: COSEKEYS.crv): number | undefined;
    get(key: COSEKEYS.x): Uint8Array | undefined;
    set(key: COSEKEYS.crv, value: number): void;
    set(key: COSEKEYS.x, value: Uint8Array): void;
};
/**
 * Values specific to Elliptic Curve Cryptography public keys
 */
export type COSEPublicKeyEC2 = COSEPublicKey & {
    get(key: COSEKEYS.crv): number | undefined;
    get(key: COSEKEYS.x): Uint8Array | undefined;
    get(key: COSEKEYS.y): Uint8Array | undefined;
    set(key: COSEKEYS.crv, value: number): void;
    set(key: COSEKEYS.x, value: Uint8Array): void;
    set(key: COSEKEYS.y, value: Uint8Array): void;
};
/**
 * Values specific to RSA public keys
 */
export type COSEPublicKeyRSA = COSEPublicKey & {
    get(key: COSEKEYS.n): Uint8Array | undefined;
    get(key: COSEKEYS.e): Uint8Array | undefined;
    set(key: COSEKEYS.n, value: Uint8Array): void;
    set(key: COSEKEYS.e, value: Uint8Array): void;
};
/**
 * A type guard for determining if a COSE public key is an OKP key pair
 */
export declare function isCOSEPublicKeyOKP(cosePublicKey: COSEPublicKey): cosePublicKey is COSEPublicKeyOKP;
/**
 * A type guard for determining if a COSE public key is an EC2 key pair
 */
export declare function isCOSEPublicKeyEC2(cosePublicKey: COSEPublicKey): cosePublicKey is COSEPublicKeyEC2;
/**
 * A type guard for determining if a COSE public key is an RSA key pair
 */
export declare function isCOSEPublicKeyRSA(cosePublicKey: COSEPublicKey): cosePublicKey is COSEPublicKeyRSA;
/**
 * COSE Keys
 *
 * https://www.iana.org/assignments/cose/cose.xhtml#key-common-parameters
 * https://www.iana.org/assignments/cose/cose.xhtml#key-type-parameters
 */
export declare enum COSEKEYS {
    kty = 1,
    alg = 3,
    crv = -1,
    x = -2,
    y = -3,
    n = -1,
    e = -2
}
/**
 * COSE Key Types
 *
 * https://www.iana.org/assignments/cose/cose.xhtml#key-type
 */
export declare enum COSEKTY {
    OKP = 1,
    EC2 = 2,
    RSA = 3
}
export declare function isCOSEKty(kty: number | undefined): kty is COSEKTY;
/**
 * COSE Curves
 *
 * https://www.iana.org/assignments/cose/cose.xhtml#elliptic-curves
 */
export declare enum COSECRV {
    P256 = 1,
    P384 = 2,
    P521 = 3,
    ED25519 = 6,
    SECP256K1 = 8
}
export declare function isCOSECrv(crv: number | undefined): crv is COSECRV;
/**
 * COSE Algorithms
 *
 * https://www.iana.org/assignments/cose/cose.xhtml#algorithms
 */
export declare enum COSEALG {
    ES256 = -7,
    EdDSA = -8,
    ES384 = -35,
    ES512 = -36,
    PS256 = -37,
    PS384 = -38,
    PS512 = -39,
    ES256K = -47,
    RS256 = -257,
    RS384 = -258,
    RS512 = -259,
    RS1 = -65535
}
export declare function isCOSEAlg(alg: number | undefined): alg is COSEALG;
//# sourceMappingURL=cose.d.ts.map