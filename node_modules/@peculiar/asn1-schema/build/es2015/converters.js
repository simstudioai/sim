import * as asn1js from "asn1js";
import { AsnPropTypes } from "./enums";
import { OctetString } from "./types/index";
export const AsnAnyConverter = {
    fromASN: (value) => value instanceof asn1js.Null ? null : value.valueBeforeDecodeView,
    toASN: (value) => {
        if (value === null) {
            return new asn1js.Null();
        }
        const schema = asn1js.fromBER(value);
        if (schema.result.error) {
            throw new Error(schema.result.error);
        }
        return schema.result;
    },
};
export const AsnIntegerConverter = {
    fromASN: (value) => value.valueBlock.valueHexView.byteLength >= 4
        ? value.valueBlock.toString()
        : value.valueBlock.valueDec,
    toASN: (value) => new asn1js.Integer({ value: +value }),
};
export const AsnEnumeratedConverter = {
    fromASN: (value) => value.valueBlock.valueDec,
    toASN: (value) => new asn1js.Enumerated({ value }),
};
export const AsnIntegerArrayBufferConverter = {
    fromASN: (value) => value.valueBlock.valueHexView,
    toASN: (value) => new asn1js.Integer({ valueHex: value }),
};
export const AsnIntegerBigIntConverter = {
    fromASN: (value) => value.toBigInt(),
    toASN: (value) => asn1js.Integer.fromBigInt(value),
};
export const AsnBitStringConverter = {
    fromASN: (value) => value.valueBlock.valueHexView,
    toASN: (value) => new asn1js.BitString({ valueHex: value }),
};
export const AsnObjectIdentifierConverter = {
    fromASN: (value) => value.valueBlock.toString(),
    toASN: (value) => new asn1js.ObjectIdentifier({ value }),
};
export const AsnBooleanConverter = {
    fromASN: (value) => value.valueBlock.value,
    toASN: (value) => new asn1js.Boolean({ value }),
};
export const AsnOctetStringConverter = {
    fromASN: (value) => value.valueBlock.valueHexView,
    toASN: (value) => new asn1js.OctetString({ valueHex: value }),
};
export const AsnConstructedOctetStringConverter = {
    fromASN: (value) => new OctetString(value.getValue()),
    toASN: (value) => value.toASN(),
};
function createStringConverter(Asn1Type) {
    return {
        fromASN: (value) => value.valueBlock.value,
        toASN: (value) => new Asn1Type({ value }),
    };
}
export const AsnUtf8StringConverter = createStringConverter(asn1js.Utf8String);
export const AsnBmpStringConverter = createStringConverter(asn1js.BmpString);
export const AsnUniversalStringConverter = createStringConverter(asn1js.UniversalString);
export const AsnNumericStringConverter = createStringConverter(asn1js.NumericString);
export const AsnPrintableStringConverter = createStringConverter(asn1js.PrintableString);
export const AsnTeletexStringConverter = createStringConverter(asn1js.TeletexString);
export const AsnVideotexStringConverter = createStringConverter(asn1js.VideotexString);
export const AsnIA5StringConverter = createStringConverter(asn1js.IA5String);
export const AsnGraphicStringConverter = createStringConverter(asn1js.GraphicString);
export const AsnVisibleStringConverter = createStringConverter(asn1js.VisibleString);
export const AsnGeneralStringConverter = createStringConverter(asn1js.GeneralString);
export const AsnCharacterStringConverter = createStringConverter(asn1js.CharacterString);
export const AsnUTCTimeConverter = {
    fromASN: (value) => value.toDate(),
    toASN: (value) => new asn1js.UTCTime({ valueDate: value }),
};
export const AsnGeneralizedTimeConverter = {
    fromASN: (value) => value.toDate(),
    toASN: (value) => new asn1js.GeneralizedTime({ valueDate: value }),
};
export const AsnNullConverter = {
    fromASN: () => null,
    toASN: () => {
        return new asn1js.Null();
    },
};
export function defaultConverter(type) {
    switch (type) {
        case AsnPropTypes.Any:
            return AsnAnyConverter;
        case AsnPropTypes.BitString:
            return AsnBitStringConverter;
        case AsnPropTypes.BmpString:
            return AsnBmpStringConverter;
        case AsnPropTypes.Boolean:
            return AsnBooleanConverter;
        case AsnPropTypes.CharacterString:
            return AsnCharacterStringConverter;
        case AsnPropTypes.Enumerated:
            return AsnEnumeratedConverter;
        case AsnPropTypes.GeneralString:
            return AsnGeneralStringConverter;
        case AsnPropTypes.GeneralizedTime:
            return AsnGeneralizedTimeConverter;
        case AsnPropTypes.GraphicString:
            return AsnGraphicStringConverter;
        case AsnPropTypes.IA5String:
            return AsnIA5StringConverter;
        case AsnPropTypes.Integer:
            return AsnIntegerConverter;
        case AsnPropTypes.Null:
            return AsnNullConverter;
        case AsnPropTypes.NumericString:
            return AsnNumericStringConverter;
        case AsnPropTypes.ObjectIdentifier:
            return AsnObjectIdentifierConverter;
        case AsnPropTypes.OctetString:
            return AsnOctetStringConverter;
        case AsnPropTypes.PrintableString:
            return AsnPrintableStringConverter;
        case AsnPropTypes.TeletexString:
            return AsnTeletexStringConverter;
        case AsnPropTypes.UTCTime:
            return AsnUTCTimeConverter;
        case AsnPropTypes.UniversalString:
            return AsnUniversalStringConverter;
        case AsnPropTypes.Utf8String:
            return AsnUtf8StringConverter;
        case AsnPropTypes.VideotexString:
            return AsnVideotexStringConverter;
        case AsnPropTypes.VisibleString:
            return AsnVisibleStringConverter;
        default:
            return null;
    }
}
