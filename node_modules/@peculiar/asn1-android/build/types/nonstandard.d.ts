import { AsnArray, OctetString } from "@peculiar/asn1-schema";
import { AuthorizationList, SecurityLevel, Version } from "./key_description";
/**
 * This file contains classes to handle non-standard key descriptions and authorizations.
 *
 * Due to an issue with the asn1-schema library, referenced at https://github.com/PeculiarVentures/asn1-schema/issues/98#issuecomment-1764345351,
 * the standard key description does not allow for a non-strict order of fields in the `softwareEnforced` and `teeEnforced` attributes.
 *
 * To address this and provide greater flexibility, the `NonStandardKeyDescription` and
 * `NonStandardAuthorizationList` classes were created, allowing for the use of non-standard authorizations and a flexible field order.
 *
 * The purpose of these modifications is to ensure compatibility with specific requirements and standards, as well as to offer
 * more convenient tools for working with key descriptions and authorizations.
 *
 * Please refer to the documentation and class comments before using or modifying them.
 */
/**
 * Represents a non-standard authorization for NonStandardAuthorizationList. It uses the same
 * structure as AuthorizationList, but it is a CHOICE instead of a SEQUENCE, that allows for
 * non-strict ordering of fields.
 */
export declare class NonStandardAuthorization extends AuthorizationList {
}
/**
 * Represents a list of non-standard authorizations.
 * ```asn
 * NonStandardAuthorizationList ::= SEQUENCE OF NonStandardAuthorization
 * ```
 */
export declare class NonStandardAuthorizationList extends AsnArray<NonStandardAuthorization> {
    constructor(items?: NonStandardAuthorization[]);
    /**
     * Finds the first authorization that contains the specified key.
     * @param key The key to search for.
     * @returns The first authorization that contains the specified key, or `undefined` if not found.
     */
    findProperty<K extends keyof AuthorizationList>(key: K): AuthorizationList[K] | undefined;
}
/**
 * The AuthorizationList class allows for non-strict ordering of fields in the
 * softwareEnforced and teeEnforced/hardwareEnforced fields.
 *
 * This behavior is due to an issue with the asn1-schema library, which is
 * documented here: https://github.com/PeculiarVentures/asn1-schema/issues/98#issuecomment-1764345351
 *
 * ```asn
 * KeyDescription ::= SEQUENCE {
 *   attestationVersion         INTEGER, # versions 1, 2, 3, 4, 100, 200, 300, and 400
 *   attestationSecurityLevel   SecurityLevel,
 *   keymasterVersion/keyMintVersion INTEGER,
 *   keymasterSecurityLevel/keyMintSecurityLevel SecurityLevel,
 *   attestationChallenge       OCTET_STRING,
 *   uniqueId                   OCTET_STRING,
 *   softwareEnforced           NonStandardAuthorizationList,
 *   teeEnforced/hardwareEnforced NonStandardAuthorizationList,
 * }
 * ```
 */
export declare class NonStandardKeyDescription {
    attestationVersion: number | Version;
    attestationSecurityLevel: SecurityLevel;
    keymasterVersion: number;
    keymasterSecurityLevel: SecurityLevel;
    attestationChallenge: OctetString;
    uniqueId: OctetString;
    softwareEnforced: NonStandardAuthorizationList;
    teeEnforced: NonStandardAuthorizationList;
    get keyMintVersion(): number;
    set keyMintVersion(value: number);
    get keyMintSecurityLevel(): SecurityLevel;
    set keyMintSecurityLevel(value: SecurityLevel);
    get hardwareEnforced(): NonStandardAuthorizationList;
    set hardwareEnforced(value: NonStandardAuthorizationList);
    constructor(params?: Partial<NonStandardKeyDescription>);
}
/**
 * New class for v300 and v400 KeyMint non-standard key description.
 * This uses the same underlying structure as NonStandardKeyDescription,
 * but with renamed properties to match the updated specification.
 */
export declare class NonStandardKeyMintKeyDescription extends NonStandardKeyDescription {
    constructor(params?: Partial<NonStandardKeyDescription>);
}
