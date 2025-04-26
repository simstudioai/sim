"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CertificateList = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const algorithm_identifier_1 = require("./algorithm_identifier");
const tbs_cert_list_1 = require("./tbs_cert_list");
class CertificateList {
    constructor(params = {}) {
        this.tbsCertList = new tbs_cert_list_1.TBSCertList();
        this.signatureAlgorithm = new algorithm_identifier_1.AlgorithmIdentifier();
        this.signature = new ArrayBuffer(0);
        Object.assign(this, params);
    }
}
exports.CertificateList = CertificateList;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: tbs_cert_list_1.TBSCertList })
], CertificateList.prototype, "tbsCertList", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: algorithm_identifier_1.AlgorithmIdentifier })
], CertificateList.prototype, "signatureAlgorithm", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.BitString })
], CertificateList.prototype, "signature", void 0);
