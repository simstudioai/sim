"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvalidityDate = exports.id_ce_invalidityDate = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const object_identifiers_1 = require("../object_identifiers");
exports.id_ce_invalidityDate = `${object_identifiers_1.id_ce}.24`;
let InvalidityDate = class InvalidityDate {
    constructor(value) {
        this.value = new Date();
        if (value) {
            this.value = value;
        }
    }
};
exports.InvalidityDate = InvalidityDate;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.GeneralizedTime })
], InvalidityDate.prototype, "value", void 0);
exports.InvalidityDate = InvalidityDate = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Choice })
], InvalidityDate);
