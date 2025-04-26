"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRLReason = exports.CRLReasons = exports.id_ce_cRLReasons = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const object_identifiers_1 = require("../object_identifiers");
exports.id_ce_cRLReasons = `${object_identifiers_1.id_ce}.21`;
var CRLReasons;
(function (CRLReasons) {
    CRLReasons[CRLReasons["unspecified"] = 0] = "unspecified";
    CRLReasons[CRLReasons["keyCompromise"] = 1] = "keyCompromise";
    CRLReasons[CRLReasons["cACompromise"] = 2] = "cACompromise";
    CRLReasons[CRLReasons["affiliationChanged"] = 3] = "affiliationChanged";
    CRLReasons[CRLReasons["superseded"] = 4] = "superseded";
    CRLReasons[CRLReasons["cessationOfOperation"] = 5] = "cessationOfOperation";
    CRLReasons[CRLReasons["certificateHold"] = 6] = "certificateHold";
    CRLReasons[CRLReasons["removeFromCRL"] = 8] = "removeFromCRL";
    CRLReasons[CRLReasons["privilegeWithdrawn"] = 9] = "privilegeWithdrawn";
    CRLReasons[CRLReasons["aACompromise"] = 10] = "aACompromise";
})(CRLReasons || (exports.CRLReasons = CRLReasons = {}));
let CRLReason = class CRLReason {
    constructor(reason = CRLReasons.unspecified) {
        this.reason = CRLReasons.unspecified;
        this.reason = reason;
    }
    toJSON() {
        return CRLReasons[this.reason];
    }
    toString() {
        return this.toJSON();
    }
};
exports.CRLReason = CRLReason;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Enumerated })
], CRLReason.prototype, "reason", void 0);
exports.CRLReason = CRLReason = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Choice })
], CRLReason);
