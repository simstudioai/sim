import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes } from "@peculiar/asn1-schema";
import { id_ce } from "../object_identifiers";
export const id_ce_privateKeyUsagePeriod = `${id_ce}.16`;
export class PrivateKeyUsagePeriod {
    constructor(params = {}) {
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: AsnPropTypes.GeneralizedTime, context: 0, implicit: true, optional: true })
], PrivateKeyUsagePeriod.prototype, "notBefore", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.GeneralizedTime, context: 1, implicit: true, optional: true })
], PrivateKeyUsagePeriod.prototype, "notAfter", void 0);
