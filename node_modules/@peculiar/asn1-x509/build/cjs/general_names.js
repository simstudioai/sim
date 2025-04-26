"use strict";
var GeneralNames_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeneralNames = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const general_name_1 = require("./general_name");
const asn1_schema_2 = require("@peculiar/asn1-schema");
let GeneralNames = GeneralNames_1 = class GeneralNames extends asn1_schema_2.AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, GeneralNames_1.prototype);
    }
};
exports.GeneralNames = GeneralNames;
exports.GeneralNames = GeneralNames = GeneralNames_1 = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Sequence, itemType: general_name_1.GeneralName })
], GeneralNames);
