import { __decorate } from "tslib";
import { AsnProp } from "@peculiar/asn1-schema";
import { DistributionPointName, Reason } from "./crl_distribution_points";
import { id_ce } from "../object_identifiers";
import { AsnPropTypes } from "@peculiar/asn1-schema";
export const id_ce_issuingDistributionPoint = `${id_ce}.28`;
export class IssuingDistributionPoint {
    constructor(params = {}) {
        this.onlyContainsUserCerts = IssuingDistributionPoint.ONLY;
        this.onlyContainsCACerts = IssuingDistributionPoint.ONLY;
        this.indirectCRL = IssuingDistributionPoint.ONLY;
        this.onlyContainsAttributeCerts = IssuingDistributionPoint.ONLY;
        Object.assign(this, params);
    }
}
IssuingDistributionPoint.ONLY = false;
__decorate([
    AsnProp({ type: DistributionPointName, context: 0, optional: true })
], IssuingDistributionPoint.prototype, "distributionPoint", void 0);
__decorate([
    AsnProp({
        type: AsnPropTypes.Boolean,
        context: 1,
        defaultValue: IssuingDistributionPoint.ONLY,
        implicit: true,
    })
], IssuingDistributionPoint.prototype, "onlyContainsUserCerts", void 0);
__decorate([
    AsnProp({
        type: AsnPropTypes.Boolean,
        context: 2,
        defaultValue: IssuingDistributionPoint.ONLY,
        implicit: true,
    })
], IssuingDistributionPoint.prototype, "onlyContainsCACerts", void 0);
__decorate([
    AsnProp({ type: Reason, context: 3, optional: true, implicit: true })
], IssuingDistributionPoint.prototype, "onlySomeReasons", void 0);
__decorate([
    AsnProp({
        type: AsnPropTypes.Boolean,
        context: 4,
        defaultValue: IssuingDistributionPoint.ONLY,
        implicit: true,
    })
], IssuingDistributionPoint.prototype, "indirectCRL", void 0);
__decorate([
    AsnProp({
        type: AsnPropTypes.Boolean,
        context: 5,
        defaultValue: IssuingDistributionPoint.ONLY,
        implicit: true,
    })
], IssuingDistributionPoint.prototype, "onlyContainsAttributeCerts", void 0);
