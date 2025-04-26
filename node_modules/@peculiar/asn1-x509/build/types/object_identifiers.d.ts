/**
 * ```asn1
 * id-pkix  OBJECT IDENTIFIER  ::=
 *               { iso(1) identified-organization(3) dod(6) internet(1)
 *                       security(5) mechanisms(5) pkix(7) }
 * ```
 */
export declare const id_pkix = "1.3.6.1.5.5.7";
/**
 * ```asn1
 * id-pe OBJECT IDENTIFIER ::= { id-pkix 1 }
 *         -- arc for private certificate extensions
 * ```
 */
export declare const id_pe = "1.3.6.1.5.5.7.1";
/**
 * ```asn1
 * id-qt OBJECT IDENTIFIER ::= { id-pkix 2 }
 *         -- arc for policy qualifier types
 * ```
 */
export declare const id_qt = "1.3.6.1.5.5.7.2";
/**
 * ```asn1
 * id-kp OBJECT IDENTIFIER ::= { id-pkix 3 }
 *         -- arc for extended key purpose OIDS
 * ```
 */
export declare const id_kp = "1.3.6.1.5.5.7.3";
/**
 * ```asn1
 * id-ad OBJECT IDENTIFIER ::= { id-pkix 48 }
 *         -- arc for access descriptors
 * ```
 */
export declare const id_ad = "1.3.6.1.5.5.7.48";
/**
 * ```asn1
 * id-qt-cps      OBJECT IDENTIFIER ::=  { id-qt 1 }
 *       -- OID for CPS qualifier
 * ```
 */
export declare const id_qt_csp = "1.3.6.1.5.5.7.2.1";
/**
 * ```asn1
 * id-qt-unotice  OBJECT IDENTIFIER ::=  { id-qt 2 }
 *       -- OID for user notice qualifier
 * ```
 */
export declare const id_qt_unotice = "1.3.6.1.5.5.7.2.2";
/**
 * ```asn1
 * id-ad-ocsp         OBJECT IDENTIFIER ::= { id-ad 1 }
 * ```
 */
export declare const id_ad_ocsp = "1.3.6.1.5.5.7.48.1";
/**
 * ```asn1
 * id-ad-caIssuers    OBJECT IDENTIFIER ::= { id-ad 2 }
 * ```
 */
export declare const id_ad_caIssuers = "1.3.6.1.5.5.7.48.2";
/**
 * ```asn1
 * id-ad-timeStamping OBJECT IDENTIFIER ::= { id-ad 3 }
 * ```
 */
export declare const id_ad_timeStamping = "1.3.6.1.5.5.7.48.3";
/**
 * ```asn1
 * id-ad-caRepository OBJECT IDENTIFIER ::= { id-ad 5 }
 * ```
 */
export declare const id_ad_caRepository = "1.3.6.1.5.5.7.48.5";
/**
 * ```asn1
 * id-ce OBJECT IDENTIFIER  ::=  {joint-iso-ccitt(2) ds(5) 29}
 * ```
 */
export declare const id_ce = "2.5.29";
