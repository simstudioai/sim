"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BasicConstraints = exports.id_ce_basicConstraints = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const object_identifiers_1 = require("../object_identifiers");
exports.id_ce_basicConstraints = `${object_identifiers_1.id_ce}.19`;
class BasicConstraints {
    constructor(params = {}) {
        this.cA = false;
        Object.assign(this, params);
    }
}
exports.BasicConstraints = BasicConstraints;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Boolean, defaultValue: false })
], BasicConstraints.prototype, "cA", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Integer, optional: true })
], BasicConstraints.prototype, "pathLenConstraint", void 0);
