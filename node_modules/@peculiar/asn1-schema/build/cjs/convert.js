"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AsnConvert = void 0;
const asn1js = require("asn1js");
const pvtsutils_1 = require("pvtsutils");
const parser_1 = require("./parser");
const serializer_1 = require("./serializer");
class AsnConvert {
    static serialize(obj) {
        return serializer_1.AsnSerializer.serialize(obj);
    }
    static parse(data, target) {
        return parser_1.AsnParser.parse(data, target);
    }
    static toString(data) {
        const buf = pvtsutils_1.BufferSourceConverter.isBufferSource(data)
            ? pvtsutils_1.BufferSourceConverter.toArrayBuffer(data)
            : AsnConvert.serialize(data);
        const asn = asn1js.fromBER(buf);
        if (asn.offset === -1) {
            throw new Error(`Cannot decode ASN.1 data. ${asn.result.error}`);
        }
        return asn.result.toString();
    }
}
exports.AsnConvert = AsnConvert;
