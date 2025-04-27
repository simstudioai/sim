"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ECParameters = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const rfc3279_1 = require("./rfc3279");
let ECParameters = class ECParameters {
    constructor(params = {}) {
        Object.assign(this, params);
    }
};
exports.ECParameters = ECParameters;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.ObjectIdentifier })
], ECParameters.prototype, "namedCurve", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Null })
], ECParameters.prototype, "implicitCurve", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: rfc3279_1.SpecifiedECDomain })
], ECParameters.prototype, "specifiedCurve", void 0);
exports.ECParameters = ECParameters = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Choice })
], ECParameters);
