"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseCRLNumber = exports.id_ce_deltaCRLIndicator = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const object_identifiers_1 = require("../object_identifiers");
const crl_number_1 = require("./crl_number");
exports.id_ce_deltaCRLIndicator = `${object_identifiers_1.id_ce}.27`;
let BaseCRLNumber = class BaseCRLNumber extends crl_number_1.CRLNumber {
};
exports.BaseCRLNumber = BaseCRLNumber;
exports.BaseCRLNumber = BaseCRLNumber = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Choice })
], BaseCRLNumber);
