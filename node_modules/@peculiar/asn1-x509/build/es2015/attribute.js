import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes } from "@peculiar/asn1-schema";
export class Attribute {
    constructor(params = {}) {
        this.type = "";
        this.values = [];
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], Attribute.prototype, "type", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Any, repeated: "set" })
], Attribute.prototype, "values", void 0);
