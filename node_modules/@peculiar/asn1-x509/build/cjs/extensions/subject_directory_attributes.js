"use strict";
var SubjectDirectoryAttributes_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubjectDirectoryAttributes = exports.id_ce_subjectDirectoryAttributes = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const attribute_1 = require("../attribute");
const object_identifiers_1 = require("../object_identifiers");
exports.id_ce_subjectDirectoryAttributes = `${object_identifiers_1.id_ce}.9`;
let SubjectDirectoryAttributes = SubjectDirectoryAttributes_1 = class SubjectDirectoryAttributes extends asn1_schema_1.AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, SubjectDirectoryAttributes_1.prototype);
    }
};
exports.SubjectDirectoryAttributes = SubjectDirectoryAttributes;
exports.SubjectDirectoryAttributes = SubjectDirectoryAttributes = SubjectDirectoryAttributes_1 = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Sequence, itemType: attribute_1.Attribute })
], SubjectDirectoryAttributes);
