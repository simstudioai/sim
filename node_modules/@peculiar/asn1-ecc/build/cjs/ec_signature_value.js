"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ECDSASigValue = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
class ECDSASigValue {
    constructor(params = {}) {
        this.r = new ArrayBuffer(0);
        this.s = new ArrayBuffer(0);
        Object.assign(this, params);
    }
}
exports.ECDSASigValue = ECDSASigValue;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Integer, converter: asn1_schema_1.AsnIntegerArrayBufferConverter })
], ECDSASigValue.prototype, "r", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Integer, converter: asn1_schema_1.AsnIntegerArrayBufferConverter })
], ECDSASigValue.prototype, "s", void 0);
