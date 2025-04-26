import { __decorate } from "tslib";
import { AsnProp } from "@peculiar/asn1-schema";
import { Time } from "./time";
export class Validity {
    constructor(params) {
        this.notBefore = new Time(new Date());
        this.notAfter = new Time(new Date());
        if (params) {
            this.notBefore = new Time(params.notBefore);
            this.notAfter = new Time(params.notAfter);
        }
    }
}
__decorate([
    AsnProp({ type: Time })
], Validity.prototype, "notBefore", void 0);
__decorate([
    AsnProp({ type: Time })
], Validity.prototype, "notAfter", void 0);
