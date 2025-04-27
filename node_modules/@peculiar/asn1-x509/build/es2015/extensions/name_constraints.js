var GeneralSubtrees_1;
import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes, AsnArray, AsnType, AsnTypeTypes } from "@peculiar/asn1-schema";
import { GeneralName } from "../general_name";
import { id_ce } from "../object_identifiers";
export const id_ce_nameConstraints = `${id_ce}.30`;
export class GeneralSubtree {
    constructor(params = {}) {
        this.base = new GeneralName();
        this.minimum = 0;
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: GeneralName })
], GeneralSubtree.prototype, "base", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Integer, context: 0, defaultValue: 0, implicit: true })
], GeneralSubtree.prototype, "minimum", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Integer, context: 1, optional: true, implicit: true })
], GeneralSubtree.prototype, "maximum", void 0);
let GeneralSubtrees = GeneralSubtrees_1 = class GeneralSubtrees extends AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, GeneralSubtrees_1.prototype);
    }
};
GeneralSubtrees = GeneralSubtrees_1 = __decorate([
    AsnType({ type: AsnTypeTypes.Sequence, itemType: GeneralSubtree })
], GeneralSubtrees);
export { GeneralSubtrees };
export class NameConstraints {
    constructor(params = {}) {
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: GeneralSubtrees, context: 0, optional: true, implicit: true })
], NameConstraints.prototype, "permittedSubtrees", void 0);
__decorate([
    AsnProp({ type: GeneralSubtrees, context: 1, optional: true, implicit: true })
], NameConstraints.prototype, "excludedSubtrees", void 0);
