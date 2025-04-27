var OtherPrimeInfos_1;
import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes, AsnIntegerArrayBufferConverter, AsnArray, AsnType, AsnTypeTypes, } from "@peculiar/asn1-schema";
export class OtherPrimeInfo {
    constructor(params = {}) {
        this.prime = new ArrayBuffer(0);
        this.exponent = new ArrayBuffer(0);
        this.coefficient = new ArrayBuffer(0);
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: AsnPropTypes.Integer, converter: AsnIntegerArrayBufferConverter })
], OtherPrimeInfo.prototype, "prime", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Integer, converter: AsnIntegerArrayBufferConverter })
], OtherPrimeInfo.prototype, "exponent", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Integer, converter: AsnIntegerArrayBufferConverter })
], OtherPrimeInfo.prototype, "coefficient", void 0);
let OtherPrimeInfos = OtherPrimeInfos_1 = class OtherPrimeInfos extends AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, OtherPrimeInfos_1.prototype);
    }
};
OtherPrimeInfos = OtherPrimeInfos_1 = __decorate([
    AsnType({ type: AsnTypeTypes.Sequence, itemType: OtherPrimeInfo })
], OtherPrimeInfos);
export { OtherPrimeInfos };
