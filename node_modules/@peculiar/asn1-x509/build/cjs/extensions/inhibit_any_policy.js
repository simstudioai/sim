"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InhibitAnyPolicy = exports.id_ce_inhibitAnyPolicy = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const object_identifiers_1 = require("../object_identifiers");
exports.id_ce_inhibitAnyPolicy = `${object_identifiers_1.id_ce}.54`;
let InhibitAnyPolicy = class InhibitAnyPolicy {
    constructor(value = new ArrayBuffer(0)) {
        this.value = value;
    }
};
exports.InhibitAnyPolicy = InhibitAnyPolicy;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Integer, converter: asn1_schema_1.AsnIntegerArrayBufferConverter })
], InhibitAnyPolicy.prototype, "value", void 0);
exports.InhibitAnyPolicy = InhibitAnyPolicy = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Choice })
], InhibitAnyPolicy);
