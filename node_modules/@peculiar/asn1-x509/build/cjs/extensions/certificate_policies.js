"use strict";
var CertificatePolicies_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CertificatePolicies = exports.PolicyInformation = exports.PolicyQualifierInfo = exports.Qualifier = exports.UserNotice = exports.NoticeReference = exports.DisplayText = exports.id_ce_certificatePolicies_anyPolicy = exports.id_ce_certificatePolicies = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const object_identifiers_1 = require("../object_identifiers");
exports.id_ce_certificatePolicies = `${object_identifiers_1.id_ce}.32`;
exports.id_ce_certificatePolicies_anyPolicy = `${exports.id_ce_certificatePolicies}.0`;
let DisplayText = class DisplayText {
    constructor(params = {}) {
        Object.assign(this, params);
    }
    toString() {
        return this.ia5String || this.visibleString || this.bmpString || this.utf8String || "";
    }
};
exports.DisplayText = DisplayText;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.IA5String })
], DisplayText.prototype, "ia5String", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.VisibleString })
], DisplayText.prototype, "visibleString", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.BmpString })
], DisplayText.prototype, "bmpString", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Utf8String })
], DisplayText.prototype, "utf8String", void 0);
exports.DisplayText = DisplayText = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Choice })
], DisplayText);
class NoticeReference {
    constructor(params = {}) {
        this.organization = new DisplayText();
        this.noticeNumbers = [];
        Object.assign(this, params);
    }
}
exports.NoticeReference = NoticeReference;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: DisplayText })
], NoticeReference.prototype, "organization", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Integer, repeated: "sequence" })
], NoticeReference.prototype, "noticeNumbers", void 0);
class UserNotice {
    constructor(params = {}) {
        Object.assign(this, params);
    }
}
exports.UserNotice = UserNotice;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: NoticeReference, optional: true })
], UserNotice.prototype, "noticeRef", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: DisplayText, optional: true })
], UserNotice.prototype, "explicitText", void 0);
let Qualifier = class Qualifier {
    constructor(params = {}) {
        Object.assign(this, params);
    }
};
exports.Qualifier = Qualifier;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.IA5String })
], Qualifier.prototype, "cPSuri", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: UserNotice })
], Qualifier.prototype, "userNotice", void 0);
exports.Qualifier = Qualifier = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Choice })
], Qualifier);
class PolicyQualifierInfo {
    constructor(params = {}) {
        this.policyQualifierId = "";
        this.qualifier = new ArrayBuffer(0);
        Object.assign(this, params);
    }
}
exports.PolicyQualifierInfo = PolicyQualifierInfo;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.ObjectIdentifier })
], PolicyQualifierInfo.prototype, "policyQualifierId", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Any })
], PolicyQualifierInfo.prototype, "qualifier", void 0);
class PolicyInformation {
    constructor(params = {}) {
        this.policyIdentifier = "";
        Object.assign(this, params);
    }
}
exports.PolicyInformation = PolicyInformation;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.ObjectIdentifier })
], PolicyInformation.prototype, "policyIdentifier", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: PolicyQualifierInfo, repeated: "sequence", optional: true })
], PolicyInformation.prototype, "policyQualifiers", void 0);
let CertificatePolicies = CertificatePolicies_1 = class CertificatePolicies extends asn1_schema_1.AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, CertificatePolicies_1.prototype);
    }
};
exports.CertificatePolicies = CertificatePolicies;
exports.CertificatePolicies = CertificatePolicies = CertificatePolicies_1 = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Sequence, itemType: PolicyInformation })
], CertificatePolicies);
