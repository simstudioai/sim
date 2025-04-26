"use strict";
var CRLDistributionPoints_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRLDistributionPoints = exports.DistributionPoint = exports.DistributionPointName = exports.Reason = exports.ReasonFlags = exports.id_ce_cRLDistributionPoints = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const name_1 = require("../name");
const general_name_1 = require("../general_name");
const object_identifiers_1 = require("../object_identifiers");
exports.id_ce_cRLDistributionPoints = `${object_identifiers_1.id_ce}.31`;
var ReasonFlags;
(function (ReasonFlags) {
    ReasonFlags[ReasonFlags["unused"] = 1] = "unused";
    ReasonFlags[ReasonFlags["keyCompromise"] = 2] = "keyCompromise";
    ReasonFlags[ReasonFlags["cACompromise"] = 4] = "cACompromise";
    ReasonFlags[ReasonFlags["affiliationChanged"] = 8] = "affiliationChanged";
    ReasonFlags[ReasonFlags["superseded"] = 16] = "superseded";
    ReasonFlags[ReasonFlags["cessationOfOperation"] = 32] = "cessationOfOperation";
    ReasonFlags[ReasonFlags["certificateHold"] = 64] = "certificateHold";
    ReasonFlags[ReasonFlags["privilegeWithdrawn"] = 128] = "privilegeWithdrawn";
    ReasonFlags[ReasonFlags["aACompromise"] = 256] = "aACompromise";
})(ReasonFlags || (exports.ReasonFlags = ReasonFlags = {}));
class Reason extends asn1_schema_1.BitString {
    toJSON() {
        const res = [];
        const flags = this.toNumber();
        if (flags & ReasonFlags.aACompromise) {
            res.push("aACompromise");
        }
        if (flags & ReasonFlags.affiliationChanged) {
            res.push("affiliationChanged");
        }
        if (flags & ReasonFlags.cACompromise) {
            res.push("cACompromise");
        }
        if (flags & ReasonFlags.certificateHold) {
            res.push("certificateHold");
        }
        if (flags & ReasonFlags.cessationOfOperation) {
            res.push("cessationOfOperation");
        }
        if (flags & ReasonFlags.keyCompromise) {
            res.push("keyCompromise");
        }
        if (flags & ReasonFlags.privilegeWithdrawn) {
            res.push("privilegeWithdrawn");
        }
        if (flags & ReasonFlags.superseded) {
            res.push("superseded");
        }
        if (flags & ReasonFlags.unused) {
            res.push("unused");
        }
        return res;
    }
    toString() {
        return `[${this.toJSON().join(", ")}]`;
    }
}
exports.Reason = Reason;
let DistributionPointName = class DistributionPointName {
    constructor(params = {}) {
        Object.assign(this, params);
    }
};
exports.DistributionPointName = DistributionPointName;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: general_name_1.GeneralName, context: 0, repeated: "sequence", implicit: true })
], DistributionPointName.prototype, "fullName", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: name_1.RelativeDistinguishedName, context: 1, implicit: true })
], DistributionPointName.prototype, "nameRelativeToCRLIssuer", void 0);
exports.DistributionPointName = DistributionPointName = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Choice })
], DistributionPointName);
class DistributionPoint {
    constructor(params = {}) {
        Object.assign(this, params);
    }
}
exports.DistributionPoint = DistributionPoint;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: DistributionPointName, context: 0, optional: true })
], DistributionPoint.prototype, "distributionPoint", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: Reason, context: 1, optional: true, implicit: true })
], DistributionPoint.prototype, "reasons", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: general_name_1.GeneralName, context: 2, optional: true, repeated: "sequence", implicit: true })
], DistributionPoint.prototype, "cRLIssuer", void 0);
let CRLDistributionPoints = CRLDistributionPoints_1 = class CRLDistributionPoints extends asn1_schema_1.AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, CRLDistributionPoints_1.prototype);
    }
};
exports.CRLDistributionPoints = CRLDistributionPoints;
exports.CRLDistributionPoints = CRLDistributionPoints = CRLDistributionPoints_1 = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Sequence, itemType: DistributionPoint })
], CRLDistributionPoints);
