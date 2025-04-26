var CRLDistributionPoints_1;
import { __decorate } from "tslib";
import { AsnProp, AsnType, AsnTypeTypes, AsnArray, BitString } from "@peculiar/asn1-schema";
import { RelativeDistinguishedName } from "../name";
import { GeneralName } from "../general_name";
import { id_ce } from "../object_identifiers";
export const id_ce_cRLDistributionPoints = `${id_ce}.31`;
export var ReasonFlags;
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
})(ReasonFlags || (ReasonFlags = {}));
export class Reason extends BitString {
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
let DistributionPointName = class DistributionPointName {
    constructor(params = {}) {
        Object.assign(this, params);
    }
};
__decorate([
    AsnProp({ type: GeneralName, context: 0, repeated: "sequence", implicit: true })
], DistributionPointName.prototype, "fullName", void 0);
__decorate([
    AsnProp({ type: RelativeDistinguishedName, context: 1, implicit: true })
], DistributionPointName.prototype, "nameRelativeToCRLIssuer", void 0);
DistributionPointName = __decorate([
    AsnType({ type: AsnTypeTypes.Choice })
], DistributionPointName);
export { DistributionPointName };
export class DistributionPoint {
    constructor(params = {}) {
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: DistributionPointName, context: 0, optional: true })
], DistributionPoint.prototype, "distributionPoint", void 0);
__decorate([
    AsnProp({ type: Reason, context: 1, optional: true, implicit: true })
], DistributionPoint.prototype, "reasons", void 0);
__decorate([
    AsnProp({ type: GeneralName, context: 2, optional: true, repeated: "sequence", implicit: true })
], DistributionPoint.prototype, "cRLIssuer", void 0);
let CRLDistributionPoints = CRLDistributionPoints_1 = class CRLDistributionPoints extends AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, CRLDistributionPoints_1.prototype);
    }
};
CRLDistributionPoints = CRLDistributionPoints_1 = __decorate([
    AsnType({ type: AsnTypeTypes.Sequence, itemType: DistributionPoint })
], CRLDistributionPoints);
export { CRLDistributionPoints };
