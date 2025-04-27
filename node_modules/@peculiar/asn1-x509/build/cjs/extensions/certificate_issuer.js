"use strict";
var CertificateIssuer_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CertificateIssuer = exports.id_ce_certificateIssuer = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const general_names_1 = require("../general_names");
const object_identifiers_1 = require("../object_identifiers");
exports.id_ce_certificateIssuer = `${object_identifiers_1.id_ce}.29`;
let CertificateIssuer = CertificateIssuer_1 = class CertificateIssuer extends general_names_1.GeneralNames {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, CertificateIssuer_1.prototype);
    }
};
exports.CertificateIssuer = CertificateIssuer;
exports.CertificateIssuer = CertificateIssuer = CertificateIssuer_1 = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Sequence })
], CertificateIssuer);
