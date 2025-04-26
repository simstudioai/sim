"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Certificate = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const algorithm_identifier_1 = require("./algorithm_identifier");
const tbs_certificate_1 = require("./tbs_certificate");
class Certificate {
    constructor(params = {}) {
        this.tbsCertificate = new tbs_certificate_1.TBSCertificate();
        this.signatureAlgorithm = new algorithm_identifier_1.AlgorithmIdentifier();
        this.signatureValue = new ArrayBuffer(0);
        Object.assign(this, params);
    }
}
exports.Certificate = Certificate;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: tbs_certificate_1.TBSCertificate })
], Certificate.prototype, "tbsCertificate", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: algorithm_identifier_1.AlgorithmIdentifier })
], Certificate.prototype, "signatureAlgorithm", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.BitString })
], Certificate.prototype, "signatureValue", void 0);
