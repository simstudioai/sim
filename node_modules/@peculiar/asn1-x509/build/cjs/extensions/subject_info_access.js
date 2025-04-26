"use strict";
var SubjectInfoAccessSyntax_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubjectInfoAccessSyntax = exports.id_pe_subjectInfoAccess = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const object_identifiers_1 = require("../object_identifiers");
const authority_information_access_1 = require("./authority_information_access");
exports.id_pe_subjectInfoAccess = `${object_identifiers_1.id_pe}.11`;
let SubjectInfoAccessSyntax = SubjectInfoAccessSyntax_1 = class SubjectInfoAccessSyntax extends asn1_schema_1.AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, SubjectInfoAccessSyntax_1.prototype);
    }
};
exports.SubjectInfoAccessSyntax = SubjectInfoAccessSyntax;
exports.SubjectInfoAccessSyntax = SubjectInfoAccessSyntax = SubjectInfoAccessSyntax_1 = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Sequence, itemType: authority_information_access_1.AccessDescription })
], SubjectInfoAccessSyntax);
