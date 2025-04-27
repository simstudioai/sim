var PolicyMappings_1;
import { __decorate } from "tslib";
import { AsnArray, AsnProp, AsnPropTypes, AsnType, AsnTypeTypes } from "@peculiar/asn1-schema";
import { id_ce } from "../object_identifiers";
export const id_ce_policyMappings = `${id_ce}.33`;
export class PolicyMapping {
    constructor(params = {}) {
        this.issuerDomainPolicy = "";
        this.subjectDomainPolicy = "";
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], PolicyMapping.prototype, "issuerDomainPolicy", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], PolicyMapping.prototype, "subjectDomainPolicy", void 0);
let PolicyMappings = PolicyMappings_1 = class PolicyMappings extends AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, PolicyMappings_1.prototype);
    }
};
PolicyMappings = PolicyMappings_1 = __decorate([
    AsnType({ type: AsnTypeTypes.Sequence, itemType: PolicyMapping })
], PolicyMappings);
export { PolicyMappings };
