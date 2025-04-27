import * as asn1js from "asn1js";
import { AnyConverterType, IAsnConverter, IntegerConverterType } from "./types";
import { AsnPropTypes } from "./enums";
import { OctetString } from "./types/index";
/**
 * NOTE: Converter MUST have name Asn<Asn1PropType.name>Converter.
 * Asn1Prop decorator link custom converters by name of the Asn1PropType
 */
/**
 * ASN.1 ANY converter
 */
export declare const AsnAnyConverter: IAsnConverter<AnyConverterType>;
/**
 * ASN.1 INTEGER to Number/String converter
 */
export declare const AsnIntegerConverter: IAsnConverter<IntegerConverterType, asn1js.Integer>;
/**
 * ASN.1 ENUMERATED converter
 */
export declare const AsnEnumeratedConverter: IAsnConverter<number, asn1js.Enumerated>;
/**
 * ASN.1 INTEGER to ArrayBuffer converter
 */
export declare const AsnIntegerArrayBufferConverter: IAsnConverter<ArrayBuffer, asn1js.Integer>;
/**
 * ASN.1 INTEGER to BigInt converter
 */
export declare const AsnIntegerBigIntConverter: IAsnConverter<bigint, asn1js.Integer>;
/**
 * ASN.1 BIT STRING converter
 */
export declare const AsnBitStringConverter: IAsnConverter<ArrayBuffer, asn1js.BitString>;
/**
 * ASN.1 OBJECT IDENTIFIER converter
 */
export declare const AsnObjectIdentifierConverter: IAsnConverter<string, asn1js.ObjectIdentifier>;
/**
 * ASN.1 BOOLEAN converter
 */
export declare const AsnBooleanConverter: IAsnConverter<boolean, asn1js.Boolean>;
/**
 * ASN.1 OCTET_STRING converter
 */
export declare const AsnOctetStringConverter: IAsnConverter<ArrayBuffer, asn1js.OctetString>;
/**
 * ASN.1 OCTET_STRING converter to OctetString class
 */
export declare const AsnConstructedOctetStringConverter: IAsnConverter<OctetString, asn1js.OctetString>;
/**
 * ASN.1 UTF8_STRING converter
 */
export declare const AsnUtf8StringConverter: IAsnConverter<string, asn1js.AsnType>;
/**
 * ASN.1 BPM STRING converter
 */
export declare const AsnBmpStringConverter: IAsnConverter<string, asn1js.AsnType>;
/**
 * ASN.1 UNIVERSAL STRING converter
 */
export declare const AsnUniversalStringConverter: IAsnConverter<string, asn1js.AsnType>;
/**
 * ASN.1 NUMERIC STRING converter
 */
export declare const AsnNumericStringConverter: IAsnConverter<string, asn1js.AsnType>;
/**
 * ASN.1 PRINTABLE STRING converter
 */
export declare const AsnPrintableStringConverter: IAsnConverter<string, asn1js.AsnType>;
/**
 * ASN.1 TELETEX STRING converter
 */
export declare const AsnTeletexStringConverter: IAsnConverter<string, asn1js.AsnType>;
/**
 * ASN.1 VIDEOTEX STRING converter
 */
export declare const AsnVideotexStringConverter: IAsnConverter<string, asn1js.AsnType>;
/**
 * ASN.1 IA5 STRING converter
 */
export declare const AsnIA5StringConverter: IAsnConverter<string, asn1js.AsnType>;
/**
 * ASN.1 GRAPHIC STRING converter
 */
export declare const AsnGraphicStringConverter: IAsnConverter<string, asn1js.AsnType>;
/**
 * ASN.1 VISIBLE STRING converter
 */
export declare const AsnVisibleStringConverter: IAsnConverter<string, asn1js.AsnType>;
/**
 * ASN.1 GENERAL STRING converter
 */
export declare const AsnGeneralStringConverter: IAsnConverter<string, asn1js.AsnType>;
/**
 * ASN.1 CHARACTER STRING converter
 */
export declare const AsnCharacterStringConverter: IAsnConverter<string, asn1js.AsnType>;
/**
 * ASN.1 UTCTime converter
 */
export declare const AsnUTCTimeConverter: IAsnConverter<Date, asn1js.UTCTime>;
/**
 * ASN.1 GeneralizedTime converter
 */
export declare const AsnGeneralizedTimeConverter: IAsnConverter<Date, asn1js.GeneralizedTime>;
/**
 * ASN.1 ANY converter
 */
export declare const AsnNullConverter: IAsnConverter<null, asn1js.Null>;
/**
 * Returns default converter for specified type
 * @param type
 */
export declare function defaultConverter(type: AsnPropTypes): IAsnConverter | null;
