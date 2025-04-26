"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRLNumber = exports.id_ce_cRLNumber = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const object_identifiers_1 = require("../object_identifiers");
exports.id_ce_cRLNumber = `${object_identifiers_1.id_ce}.20`;
let CRLNumber = class CRLNumber {
    constructor(value = 0) {
        this.value = value;
    }
};
exports.CRLNumber = CRLNumber;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Integer })
], CRLNumber.prototype, "value", void 0);
exports.CRLNumber = CRLNumber = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Choice })
], CRLNumber);
