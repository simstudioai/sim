"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RSAPublicKey = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
class RSAPublicKey {
    constructor(params = {}) {
        this.modulus = new ArrayBuffer(0);
        this.publicExponent = new ArrayBuffer(0);
        Object.assign(this, params);
    }
}
exports.RSAPublicKey = RSAPublicKey;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Integer, converter: asn1_schema_1.AsnIntegerArrayBufferConverter })
], RSAPublicKey.prototype, "modulus", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Integer, converter: asn1_schema_1.AsnIntegerArrayBufferConverter })
], RSAPublicKey.prototype, "publicExponent", void 0);
