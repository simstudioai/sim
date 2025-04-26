"use strict";
var IssueAlternativeName_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.IssueAlternativeName = exports.id_ce_issuerAltName = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const general_names_1 = require("../general_names");
const object_identifiers_1 = require("../object_identifiers");
exports.id_ce_issuerAltName = `${object_identifiers_1.id_ce}.18`;
let IssueAlternativeName = IssueAlternativeName_1 = class IssueAlternativeName extends general_names_1.GeneralNames {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, IssueAlternativeName_1.prototype);
    }
};
exports.IssueAlternativeName = IssueAlternativeName;
exports.IssueAlternativeName = IssueAlternativeName = IssueAlternativeName_1 = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Sequence })
], IssueAlternativeName);
