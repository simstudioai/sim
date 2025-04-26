import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes, AsnType, AsnTypeTypes, AsnIntegerArrayBufferConverter, } from "@peculiar/asn1-schema";
import { id_ce } from "../object_identifiers";
export const id_ce_inhibitAnyPolicy = `${id_ce}.54`;
let InhibitAnyPolicy = class InhibitAnyPolicy {
    constructor(value = new ArrayBuffer(0)) {
        this.value = value;
    }
};
__decorate([
    AsnProp({ type: AsnPropTypes.Integer, converter: AsnIntegerArrayBufferConverter })
], InhibitAnyPolicy.prototype, "value", void 0);
InhibitAnyPolicy = __decorate([
    AsnType({ type: AsnTypeTypes.Choice })
], InhibitAnyPolicy);
export { InhibitAnyPolicy };
