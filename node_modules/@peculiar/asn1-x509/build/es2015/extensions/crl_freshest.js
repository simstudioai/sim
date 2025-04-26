var FreshestCRL_1;
import { __decorate } from "tslib";
import { AsnType, AsnTypeTypes } from "@peculiar/asn1-schema";
import { id_ce } from "../object_identifiers";
import { CRLDistributionPoints, DistributionPoint } from "./crl_distribution_points";
export const id_ce_freshestCRL = `${id_ce}.46`;
let FreshestCRL = FreshestCRL_1 = class FreshestCRL extends CRLDistributionPoints {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, FreshestCRL_1.prototype);
    }
};
FreshestCRL = FreshestCRL_1 = __decorate([
    AsnType({ type: AsnTypeTypes.Sequence, itemType: DistributionPoint })
], FreshestCRL);
export { FreshestCRL };
