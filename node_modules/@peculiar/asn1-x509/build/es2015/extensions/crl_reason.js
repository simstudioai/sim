import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes, AsnType, AsnTypeTypes } from "@peculiar/asn1-schema";
import { id_ce } from "../object_identifiers";
export const id_ce_cRLReasons = `${id_ce}.21`;
export var CRLReasons;
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
})(CRLReasons || (CRLReasons = {}));
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
__decorate([
    AsnProp({ type: AsnPropTypes.Enumerated })
], CRLReason.prototype, "reason", void 0);
CRLReason = __decorate([
    AsnType({ type: AsnTypeTypes.Choice })
], CRLReason);
export { CRLReason };
