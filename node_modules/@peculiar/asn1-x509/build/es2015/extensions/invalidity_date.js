import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes, AsnType, AsnTypeTypes } from "@peculiar/asn1-schema";
import { id_ce } from "../object_identifiers";
export const id_ce_invalidityDate = `${id_ce}.24`;
let InvalidityDate = class InvalidityDate {
    constructor(value) {
        this.value = new Date();
        if (value) {
            this.value = value;
        }
    }
};
__decorate([
    AsnProp({ type: AsnPropTypes.GeneralizedTime })
], InvalidityDate.prototype, "value", void 0);
InvalidityDate = __decorate([
    AsnType({ type: AsnTypeTypes.Choice })
], InvalidityDate);
export { InvalidityDate };
