"use strict";
var GeneralSubtrees_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NameConstraints = exports.GeneralSubtrees = exports.GeneralSubtree = exports.id_ce_nameConstraints = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const general_name_1 = require("../general_name");
const object_identifiers_1 = require("../object_identifiers");
exports.id_ce_nameConstraints = `${object_identifiers_1.id_ce}.30`;
class GeneralSubtree {
    constructor(params = {}) {
        this.base = new general_name_1.GeneralName();
        this.minimum = 0;
        Object.assign(this, params);
    }
}
exports.GeneralSubtree = GeneralSubtree;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: general_name_1.GeneralName })
], GeneralSubtree.prototype, "base", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Integer, context: 0, defaultValue: 0, implicit: true })
], GeneralSubtree.prototype, "minimum", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Integer, context: 1, optional: true, implicit: true })
], GeneralSubtree.prototype, "maximum", void 0);
let GeneralSubtrees = GeneralSubtrees_1 = class GeneralSubtrees extends asn1_schema_1.AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, GeneralSubtrees_1.prototype);
    }
};
exports.GeneralSubtrees = GeneralSubtrees;
exports.GeneralSubtrees = GeneralSubtrees = GeneralSubtrees_1 = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Sequence, itemType: GeneralSubtree })
], GeneralSubtrees);
class NameConstraints {
    constructor(params = {}) {
        Object.assign(this, params);
    }
}
exports.NameConstraints = NameConstraints;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: GeneralSubtrees, context: 0, optional: true, implicit: true })
], NameConstraints.prototype, "permittedSubtrees", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: GeneralSubtrees, context: 1, optional: true, implicit: true })
], NameConstraints.prototype, "excludedSubtrees", void 0);
