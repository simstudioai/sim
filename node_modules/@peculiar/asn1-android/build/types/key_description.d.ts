import { AsnArray, OctetString } from "@peculiar/asn1-schema";
/**
 * Extension OID for key description.
 *
 * ```asn
 * id-ce-keyDescription OBJECT IDENTIFIER ::= { 1 3 6 1 4 1 11129 2 1 17 }
 * ```
 */
export declare const id_ce_keyDescription = "1.3.6.1.4.1.11129.2.1.17";
/**
 * Implements ASN.1 enumeration for verified boot state.
 *
 * ```asn
 * VerifiedBootState ::= ENUMERATED {
 *   Verified                   (0),
 *   SelfSigned                 (1),
 *   Unverified                 (2),
 *   Failed                     (3),
 * }
 * ```
 */
export declare enum VerifiedBootState {
    verified = 0,
    selfSigned = 1,
    unverified = 2,
    failed = 3
}
/**
 * Implements ASN.1 structure for root of trust.
 *
 * ```asn
 * RootOfTrust ::= SEQUENCE {
 *   verifiedBootKey            OCTET_STRING,
 *   deviceLocked               BOOLEAN,
 *   verifiedBootState          VerifiedBootState,
 *   verifiedBootHash           OCTET_STRING, # KM4
 * }
 * ```
 */
export declare class RootOfTrust {
    verifiedBootKey: OctetString;
    deviceLocked: boolean;
    verifiedBootState: VerifiedBootState;
    /**
     * `verifiedBootHash` must present in `KeyDescription` version 3
     */
    verifiedBootHash?: OctetString;
    constructor(params?: Partial<RootOfTrust>);
}
/**
 * Implements ASN.1 structure for set of integers.
 *
 * ```asn
 * IntegerSet ::= SET OF INTEGER
 * ```
 */
export declare class IntegerSet extends AsnArray<number> {
    constructor(items?: number[]);
}
/**
 * Implements ASN.1 structure for authorization list.
 *
 * ```asn
 * AuthorizationList ::= SEQUENCE {
 *   purpose                     [1] EXPLICIT SET OF INTEGER OPTIONAL,
 *   algorithm                   [2] EXPLICIT INTEGER OPTIONAL,
 *   keySize                     [3] EXPLICIT INTEGER OPTIONAL.
 *   digest                      [5] EXPLICIT SET OF INTEGER OPTIONAL,
 *   padding                     [6] EXPLICIT SET OF INTEGER OPTIONAL,
 *   ecCurve                     [10] EXPLICIT INTEGER OPTIONAL,
 *   rsaPublicExponent           [200] EXPLICIT INTEGER OPTIONAL,
 *   mgfDigest                   [203] EXPLICIT SET OF INTEGER OPTIONAL,
 *   rollbackResistance          [303] EXPLICIT NULL OPTIONAL, # KM4
 *   earlyBootOnly               [305] EXPLICIT NULL OPTIONAL, # version 4
 *   activeDateTime              [400] EXPLICIT INTEGER OPTIONAL
 *   originationExpireDateTime   [401] EXPLICIT INTEGER OPTIONAL
 *   usageExpireDateTime         [402] EXPLICIT INTEGER OPTIONAL
 *   usageCountLimit             [405] EXPLICIT INTEGER OPTIONAL,
 *   noAuthRequired              [503] EXPLICIT NULL OPTIONAL,
 *   userAuthType                [504] EXPLICIT INTEGER OPTIONAL,
 *   authTimeout                 [505] EXPLICIT INTEGER OPTIONAL,
 *   allowWhileOnBody            [506] EXPLICIT NULL OPTIONAL,
 *   trustedUserPresenceRequired [507] EXPLICIT NULL OPTIONAL, # KM4
 *   trustedConfirmationRequired [508] EXPLICIT NULL OPTIONAL, # KM4
 *   unlockedDeviceRequired      [509] EXPLICIT NULL OPTIONAL, # KM4
 *   allApplications             [600] EXPLICIT NULL OPTIONAL,
 *   applicationId               [601] EXPLICIT OCTET_STRING OPTIONAL,
 *   creationDateTime            [701] EXPLICIT INTEGER OPTIONAL,
 *   origin                      [702] EXPLICIT INTEGER OPTIONAL,
 *   rollbackResistant           [703] EXPLICIT NULL OPTIONAL, # KM2 and KM3 only.
 *   rootOfTrust                 [704] EXPLICIT RootOfTrust OPTIONAL,
 *   osVersion                   [705] EXPLICIT INTEGER OPTIONAL,
 *   osPatchLevel                [706] EXPLICIT INTEGER OPTIONAL,
 *   attestationApplicationId    [709] EXPLICIT OCTET_STRING OPTIONAL, # KM3
 *   attestationIdBrand          [710] EXPLICIT OCTET_STRING OPTIONAL, # KM3
 *   attestationIdDevice         [711] EXPLICIT OCTET_STRING OPTIONAL, # KM3
 *   attestationIdProduct        [712] EXPLICIT OCTET_STRING OPTIONAL, # KM3
 *   attestationIdSerial         [713] EXPLICIT OCTET_STRING OPTIONAL, # KM3
 *   attestationIdImei           [714] EXPLICIT OCTET_STRING OPTIONAL, # KM3
 *   attestationIdMeid           [715] EXPLICIT OCTET_STRING OPTIONAL, # KM3
 *   attestationIdManufacturer   [716] EXPLICIT OCTET_STRING OPTIONAL, # KM3
 *   attestationIdModel          [717] EXPLICIT OCTET_STRING OPTIONAL, # KM3
 *   vendorPatchLevel            [718] EXPLICIT INTEGER OPTIONAL, # KM4
 *   bootPatchLevel              [719] EXPLICIT INTEGER OPTIONAL, # KM4
 *   deviceUniqueAttestation     [720] EXPLICIT NULL OPTIONAL, # version 4
 *   attestationIdSecondImei     [723] EXPLICIT OCTET_STRING OPTIONAL,
 *   moduleHash                  [724] EXPLICIT OCTET_STRING OPTIONAL,
 * }
 * ```
 */
export declare class AuthorizationList {
    purpose?: IntegerSet;
    algorithm?: number;
    keySize?: number;
    digest?: IntegerSet;
    padding?: IntegerSet;
    ecCurve?: number;
    rsaPublicExponent?: number;
    mgfDigest?: IntegerSet;
    rollbackResistance?: null;
    earlyBootOnly?: null;
    activeDateTime?: number;
    originationExpireDateTime?: number;
    usageExpireDateTime?: number;
    usageCountLimit?: number;
    noAuthRequired?: null;
    userAuthType?: number;
    authTimeout?: number;
    allowWhileOnBody?: null;
    trustedUserPresenceRequired?: null;
    trustedConfirmationRequired?: null;
    unlockedDeviceRequired?: null;
    allApplications?: null;
    applicationId?: OctetString;
    creationDateTime?: number;
    origin?: number;
    rollbackResistant?: null;
    rootOfTrust?: RootOfTrust;
    osVersion?: number;
    osPatchLevel?: number;
    attestationApplicationId?: OctetString;
    attestationIdBrand?: OctetString;
    attestationIdDevice?: OctetString;
    attestationIdProduct?: OctetString;
    attestationIdSerial?: OctetString;
    attestationIdImei?: OctetString;
    attestationIdMeid?: OctetString;
    attestationIdManufacturer?: OctetString;
    attestationIdModel?: OctetString;
    vendorPatchLevel?: number;
    bootPatchLevel?: number;
    deviceUniqueAttestation?: null;
    attestationIdSecondImei?: OctetString;
    moduleHash?: OctetString;
    constructor(params?: Partial<AuthorizationList>);
}
/**
 * Implements ASN.1 structure for security level.
 *
 * ```asn
 * SecurityLevel ::= ENUMERATED {
 *   Software                   (0),
 *   TrustedEnvironment         (1),
 *   StrongBox                  (2),
 * }
 * ```
 */
export declare enum SecurityLevel {
    software = 0,
    trustedEnvironment = 1,
    strongBox = 2
}
export declare enum Version {
    KM2 = 1,
    KM3 = 2,
    KM4 = 3,
    KM4_1 = 4,
    keyMint1 = 100,
    keyMint2 = 200,
    keyMint3 = 300,
    keyMint4 = 400
}
/**
 * Implements ASN.1 structure for key description.
 *
 * ```asn
 * KeyDescription ::= SEQUENCE {
 *   attestationVersion         INTEGER, # versions 1, 2, 3, 4, 100, and 200
 *   attestationSecurityLevel   SecurityLevel,
 *   keymasterVersion           INTEGER,
 *   keymasterSecurityLevel     SecurityLevel,
 *   attestationChallenge       OCTET_STRING,
 *   uniqueId                   OCTET_STRING,
 *   softwareEnforced           AuthorizationList,
 *   teeEnforced                AuthorizationList,
 * }
 * ```
 */
export declare class KeyDescription {
    attestationVersion: number | Version;
    attestationSecurityLevel: SecurityLevel;
    keymasterVersion: number;
    keymasterSecurityLevel: SecurityLevel;
    attestationChallenge: OctetString;
    uniqueId: OctetString;
    softwareEnforced: AuthorizationList;
    teeEnforced: AuthorizationList;
    constructor(params?: Partial<KeyDescription>);
}
/**
 * Implements ASN.1 structure for KeyMint key description (v300 and v400).
 *
 * ```asn
 * KeyDescription ::= SEQUENCE {
 *   attestationVersion         INTEGER, # versions 300 and 400
 *   attestationSecurityLevel   SecurityLevel,
 *   keyMintVersion             INTEGER,
 *   keyMintSecurityLevel       SecurityLevel,
 *   attestationChallenge       OCTET_STRING,
 *   uniqueId                   OCTET_STRING,
 *   softwareEnforced           AuthorizationList,
 *   hardwareEnforced           AuthorizationList,
 * }
 * ```
 */
export declare class KeyMintKeyDescription {
    attestationVersion: number | Version;
    attestationSecurityLevel: SecurityLevel;
    keyMintVersion: number;
    keyMintSecurityLevel: SecurityLevel;
    attestationChallenge: OctetString;
    uniqueId: OctetString;
    softwareEnforced: AuthorizationList;
    hardwareEnforced: AuthorizationList;
    constructor(params?: Partial<KeyMintKeyDescription>);
    /**
     * Convert to legacy KeyDescription for backwards compatibility
     */
    toLegacyKeyDescription(): KeyDescription;
    /**
     * Create from legacy KeyDescription for backwards compatibility
     */
    static fromLegacyKeyDescription(keyDesc: KeyDescription): KeyMintKeyDescription;
}
