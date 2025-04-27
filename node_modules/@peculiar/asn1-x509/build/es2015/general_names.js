var GeneralNames_1;
import { __decorate } from "tslib";
import { AsnType, AsnTypeTypes } from "@peculiar/asn1-schema";
import { GeneralName } from "./general_name";
import { AsnArray } from "@peculiar/asn1-schema";
let GeneralNames = GeneralNames_1 = class GeneralNames extends AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, GeneralNames_1.prototype);
    }
};
GeneralNames = GeneralNames_1 = __decorate([
    AsnType({ type: AsnTypeTypes.Sequence, itemType: GeneralName })
], GeneralNames);
export { GeneralNames };
