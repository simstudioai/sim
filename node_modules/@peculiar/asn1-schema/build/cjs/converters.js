"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AsnNullConverter = exports.AsnGeneralizedTimeConverter = exports.AsnUTCTimeConverter = exports.AsnCharacterStringConverter = exports.AsnGeneralStringConverter = exports.AsnVisibleStringConverter = exports.AsnGraphicStringConverter = exports.AsnIA5StringConverter = exports.AsnVideotexStringConverter = exports.AsnTeletexStringConverter = exports.AsnPrintableStringConverter = exports.AsnNumericStringConverter = exports.AsnUniversalStringConverter = exports.AsnBmpStringConverter = exports.AsnUtf8StringConverter = exports.AsnConstructedOctetStringConverter = exports.AsnOctetStringConverter = exports.AsnBooleanConverter = exports.AsnObjectIdentifierConverter = exports.AsnBitStringConverter = exports.AsnIntegerBigIntConverter = exports.AsnIntegerArrayBufferConverter = exports.AsnEnumeratedConverter = exports.AsnIntegerConverter = exports.AsnAnyConverter = void 0;
exports.defaultConverter = defaultConverter;
const asn1js = require("asn1js");
const enums_1 = require("./enums");
const index_1 = require("./types/index");
exports.AsnAnyConverter = {
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
exports.AsnIntegerConverter = {
    fromASN: (value) => value.valueBlock.valueHexView.byteLength >= 4
        ? value.valueBlock.toString()
        : value.valueBlock.valueDec,
    toASN: (value) => new asn1js.Integer({ value: +value }),
};
exports.AsnEnumeratedConverter = {
    fromASN: (value) => value.valueBlock.valueDec,
    toASN: (value) => new asn1js.Enumerated({ value }),
};
exports.AsnIntegerArrayBufferConverter = {
    fromASN: (value) => value.valueBlock.valueHexView,
    toASN: (value) => new asn1js.Integer({ valueHex: value }),
};
exports.AsnIntegerBigIntConverter = {
    fromASN: (value) => value.toBigInt(),
    toASN: (value) => asn1js.Integer.fromBigInt(value),
};
exports.AsnBitStringConverter = {
    fromASN: (value) => value.valueBlock.valueHexView,
    toASN: (value) => new asn1js.BitString({ valueHex: value }),
};
exports.AsnObjectIdentifierConverter = {
    fromASN: (value) => value.valueBlock.toString(),
    toASN: (value) => new asn1js.ObjectIdentifier({ value }),
};
exports.AsnBooleanConverter = {
    fromASN: (value) => value.valueBlock.value,
    toASN: (value) => new asn1js.Boolean({ value }),
};
exports.AsnOctetStringConverter = {
    fromASN: (value) => value.valueBlock.valueHexView,
    toASN: (value) => new asn1js.OctetString({ valueHex: value }),
};
exports.AsnConstructedOctetStringConverter = {
    fromASN: (value) => new index_1.OctetString(value.getValue()),
    toASN: (value) => value.toASN(),
};
function createStringConverter(Asn1Type) {
    return {
        fromASN: (value) => value.valueBlock.value,
        toASN: (value) => new Asn1Type({ value }),
    };
}
exports.AsnUtf8StringConverter = createStringConverter(asn1js.Utf8String);
exports.AsnBmpStringConverter = createStringConverter(asn1js.BmpString);
exports.AsnUniversalStringConverter = createStringConverter(asn1js.UniversalString);
exports.AsnNumericStringConverter = createStringConverter(asn1js.NumericString);
exports.AsnPrintableStringConverter = createStringConverter(asn1js.PrintableString);
exports.AsnTeletexStringConverter = createStringConverter(asn1js.TeletexString);
exports.AsnVideotexStringConverter = createStringConverter(asn1js.VideotexString);
exports.AsnIA5StringConverter = createStringConverter(asn1js.IA5String);
exports.AsnGraphicStringConverter = createStringConverter(asn1js.GraphicString);
exports.AsnVisibleStringConverter = createStringConverter(asn1js.VisibleString);
exports.AsnGeneralStringConverter = createStringConverter(asn1js.GeneralString);
exports.AsnCharacterStringConverter = createStringConverter(asn1js.CharacterString);
exports.AsnUTCTimeConverter = {
    fromASN: (value) => value.toDate(),
    toASN: (value) => new asn1js.UTCTime({ valueDate: value }),
};
exports.AsnGeneralizedTimeConverter = {
    fromASN: (value) => value.toDate(),
    toASN: (value) => new asn1js.GeneralizedTime({ valueDate: value }),
};
exports.AsnNullConverter = {
    fromASN: () => null,
    toASN: () => {
        return new asn1js.Null();
    },
};
function defaultConverter(type) {
    switch (type) {
        case enums_1.AsnPropTypes.Any:
            return exports.AsnAnyConverter;
        case enums_1.AsnPropTypes.BitString:
            return exports.AsnBitStringConverter;
        case enums_1.AsnPropTypes.BmpString:
            return exports.AsnBmpStringConverter;
        case enums_1.AsnPropTypes.Boolean:
            return exports.AsnBooleanConverter;
        case enums_1.AsnPropTypes.CharacterString:
            return exports.AsnCharacterStringConverter;
        case enums_1.AsnPropTypes.Enumerated:
            return exports.AsnEnumeratedConverter;
        case enums_1.AsnPropTypes.GeneralString:
            return exports.AsnGeneralStringConverter;
        case enums_1.AsnPropTypes.GeneralizedTime:
            return exports.AsnGeneralizedTimeConverter;
        case enums_1.AsnPropTypes.GraphicString:
            return exports.AsnGraphicStringConverter;
        case enums_1.AsnPropTypes.IA5String:
            return exports.AsnIA5StringConverter;
        case enums_1.AsnPropTypes.Integer:
            return exports.AsnIntegerConverter;
        case enums_1.AsnPropTypes.Null:
            return exports.AsnNullConverter;
        case enums_1.AsnPropTypes.NumericString:
            return exports.AsnNumericStringConverter;
        case enums_1.AsnPropTypes.ObjectIdentifier:
            return exports.AsnObjectIdentifierConverter;
        case enums_1.AsnPropTypes.OctetString:
            return exports.AsnOctetStringConverter;
        case enums_1.AsnPropTypes.PrintableString:
            return exports.AsnPrintableStringConverter;
        case enums_1.AsnPropTypes.TeletexString:
            return exports.AsnTeletexStringConverter;
        case enums_1.AsnPropTypes.UTCTime:
            return exports.AsnUTCTimeConverter;
        case enums_1.AsnPropTypes.UniversalString:
            return exports.AsnUniversalStringConverter;
        case enums_1.AsnPropTypes.Utf8String:
            return exports.AsnUtf8StringConverter;
        case enums_1.AsnPropTypes.VideotexString:
            return exports.AsnVideotexStringConverter;
        case enums_1.AsnPropTypes.VisibleString:
            return exports.AsnVisibleStringConverter;
        default:
            return null;
    }
}
