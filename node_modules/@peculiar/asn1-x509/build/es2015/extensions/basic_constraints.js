import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes } from "@peculiar/asn1-schema";
import { id_ce } from "../object_identifiers";
export const id_ce_basicConstraints = `${id_ce}.19`;
export class BasicConstraints {
    constructor(params = {}) {
        this.cA = false;
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: AsnPropTypes.Boolean, defaultValue: false })
], BasicConstraints.prototype, "cA", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Integer, optional: true })
], BasicConstraints.prototype, "pathLenConstraint", void 0);
