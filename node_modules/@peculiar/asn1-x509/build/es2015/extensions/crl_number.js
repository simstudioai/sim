import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes, AsnType, AsnTypeTypes } from "@peculiar/asn1-schema";
import { id_ce } from "../object_identifiers";
export const id_ce_cRLNumber = `${id_ce}.20`;
let CRLNumber = class CRLNumber {
    constructor(value = 0) {
        this.value = value;
    }
};
__decorate([
    AsnProp({ type: AsnPropTypes.Integer })
], CRLNumber.prototype, "value", void 0);
CRLNumber = __decorate([
    AsnType({ type: AsnTypeTypes.Choice })
], CRLNumber);
export { CRLNumber };
