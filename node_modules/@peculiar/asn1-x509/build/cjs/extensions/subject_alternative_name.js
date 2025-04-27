"use strict";
var SubjectAlternativeName_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubjectAlternativeName = exports.id_ce_subjectAltName = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const general_names_1 = require("../general_names");
const object_identifiers_1 = require("../object_identifiers");
exports.id_ce_subjectAltName = `${object_identifiers_1.id_ce}.17`;
let SubjectAlternativeName = SubjectAlternativeName_1 = class SubjectAlternativeName extends general_names_1.GeneralNames {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, SubjectAlternativeName_1.prototype);
    }
};
exports.SubjectAlternativeName = SubjectAlternativeName;
exports.SubjectAlternativeName = SubjectAlternativeName = SubjectAlternativeName_1 = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Sequence })
], SubjectAlternativeName);
