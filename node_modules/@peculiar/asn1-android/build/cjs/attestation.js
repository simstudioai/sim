"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AttestationApplicationId = exports.AttestationPackageInfo = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
class AttestationPackageInfo {
    constructor(params = {}) {
        Object.assign(this, params);
    }
}
exports.AttestationPackageInfo = AttestationPackageInfo;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.OctetString })
], AttestationPackageInfo.prototype, "packageName", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Integer })
], AttestationPackageInfo.prototype, "version", void 0);
class AttestationApplicationId {
    constructor(params = {}) {
        Object.assign(this, params);
    }
}
exports.AttestationApplicationId = AttestationApplicationId;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: AttestationPackageInfo, repeated: "set" })
], AttestationApplicationId.prototype, "packageInfos", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.OctetString, repeated: "set" })
], AttestationApplicationId.prototype, "signatureDigests", void 0);
