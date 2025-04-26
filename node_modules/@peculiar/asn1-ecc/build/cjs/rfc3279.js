"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpecifiedECDomain = exports.ECPVer = exports.Curve = exports.FieldElement = exports.ECPoint = exports.FieldID = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
let FieldID = class FieldID {
    constructor(params = {}) {
        Object.assign(this, params);
    }
};
exports.FieldID = FieldID;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.ObjectIdentifier })
], FieldID.prototype, "fieldType", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Any })
], FieldID.prototype, "parameters", void 0);
exports.FieldID = FieldID = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Sequence })
], FieldID);
class ECPoint extends asn1_schema_1.OctetString {
}
exports.ECPoint = ECPoint;
class FieldElement extends asn1_schema_1.OctetString {
}
exports.FieldElement = FieldElement;
let Curve = class Curve {
    constructor(params = {}) {
        Object.assign(this, params);
    }
};
exports.Curve = Curve;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.OctetString })
], Curve.prototype, "a", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.OctetString })
], Curve.prototype, "b", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.BitString, optional: true })
], Curve.prototype, "seed", void 0);
exports.Curve = Curve = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Sequence })
], Curve);
var ECPVer;
(function (ECPVer) {
    ECPVer[ECPVer["ecpVer1"] = 1] = "ecpVer1";
})(ECPVer || (exports.ECPVer = ECPVer = {}));
let SpecifiedECDomain = class SpecifiedECDomain {
    constructor(params = {}) {
        this.version = ECPVer.ecpVer1;
        Object.assign(this, params);
    }
};
exports.SpecifiedECDomain = SpecifiedECDomain;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Integer })
], SpecifiedECDomain.prototype, "version", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: FieldID })
], SpecifiedECDomain.prototype, "fieldID", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: Curve })
], SpecifiedECDomain.prototype, "curve", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: ECPoint })
], SpecifiedECDomain.prototype, "base", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Integer, converter: asn1_schema_1.AsnIntegerArrayBufferConverter })
], SpecifiedECDomain.prototype, "order", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Integer, optional: true })
], SpecifiedECDomain.prototype, "cofactor", void 0);
exports.SpecifiedECDomain = SpecifiedECDomain = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Sequence })
], SpecifiedECDomain);
