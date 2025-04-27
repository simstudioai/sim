"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TBSCertificate = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const algorithm_identifier_1 = require("./algorithm_identifier");
const name_1 = require("./name");
const subject_public_key_info_1 = require("./subject_public_key_info");
const validity_1 = require("./validity");
const extension_1 = require("./extension");
const types_1 = require("./types");
class TBSCertificate {
    constructor(params = {}) {
        this.version = types_1.Version.v1;
        this.serialNumber = new ArrayBuffer(0);
        this.signature = new algorithm_identifier_1.AlgorithmIdentifier();
        this.issuer = new name_1.Name();
        this.validity = new validity_1.Validity();
        this.subject = new name_1.Name();
        this.subjectPublicKeyInfo = new subject_public_key_info_1.SubjectPublicKeyInfo();
        Object.assign(this, params);
    }
}
exports.TBSCertificate = TBSCertificate;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({
        type: asn1_schema_1.AsnPropTypes.Integer,
        context: 0,
        defaultValue: types_1.Version.v1,
    })
], TBSCertificate.prototype, "version", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({
        type: asn1_schema_1.AsnPropTypes.Integer,
        converter: asn1_schema_1.AsnIntegerArrayBufferConverter,
    })
], TBSCertificate.prototype, "serialNumber", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: algorithm_identifier_1.AlgorithmIdentifier })
], TBSCertificate.prototype, "signature", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: name_1.Name })
], TBSCertificate.prototype, "issuer", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: validity_1.Validity })
], TBSCertificate.prototype, "validity", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: name_1.Name })
], TBSCertificate.prototype, "subject", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: subject_public_key_info_1.SubjectPublicKeyInfo })
], TBSCertificate.prototype, "subjectPublicKeyInfo", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({
        type: asn1_schema_1.AsnPropTypes.BitString,
        context: 1,
        implicit: true,
        optional: true,
    })
], TBSCertificate.prototype, "issuerUniqueID", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.BitString, context: 2, implicit: true, optional: true })
], TBSCertificate.prototype, "subjectUniqueID", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: extension_1.Extensions, context: 3, optional: true })
], TBSCertificate.prototype, "extensions", void 0);
