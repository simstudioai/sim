var Extensions_1;
import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes, AsnArray, AsnType, AsnTypeTypes, OctetString, } from "@peculiar/asn1-schema";
export class Extension {
    constructor(params = {}) {
        this.extnID = "";
        this.critical = Extension.CRITICAL;
        this.extnValue = new OctetString();
        Object.assign(this, params);
    }
}
Extension.CRITICAL = false;
__decorate([
    AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], Extension.prototype, "extnID", void 0);
__decorate([
    AsnProp({
        type: AsnPropTypes.Boolean,
        defaultValue: Extension.CRITICAL,
    })
], Extension.prototype, "critical", void 0);
__decorate([
    AsnProp({ type: OctetString })
], Extension.prototype, "extnValue", void 0);
let Extensions = Extensions_1 = class Extensions extends AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, Extensions_1.prototype);
    }
};
Extensions = Extensions_1 = __decorate([
    AsnType({ type: AsnTypeTypes.Sequence, itemType: Extension })
], Extensions);
export { Extensions };
