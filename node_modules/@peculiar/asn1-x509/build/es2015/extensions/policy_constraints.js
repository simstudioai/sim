import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes, AsnIntegerArrayBufferConverter } from "@peculiar/asn1-schema";
import { id_ce } from "../object_identifiers";
export const id_ce_policyConstraints = `${id_ce}.36`;
export class PolicyConstraints {
    constructor(params = {}) {
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({
        type: AsnPropTypes.Integer,
        context: 0,
        implicit: true,
        optional: true,
        converter: AsnIntegerArrayBufferConverter,
    })
], PolicyConstraints.prototype, "requireExplicitPolicy", void 0);
__decorate([
    AsnProp({
        type: AsnPropTypes.Integer,
        context: 1,
        implicit: true,
        optional: true,
        converter: AsnIntegerArrayBufferConverter,
    })
], PolicyConstraints.prototype, "inhibitPolicyMapping", void 0);
