"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DigestInfo = void 0;
const tslib_1 = require("tslib");
const asn1_x509_1 = require("@peculiar/asn1-x509");
const asn1_schema_1 = require("@peculiar/asn1-schema");
class DigestInfo {
    constructor(params = {}) {
        this.digestAlgorithm = new asn1_x509_1.AlgorithmIdentifier();
        this.digest = new asn1_schema_1.OctetString();
        Object.assign(this, params);
    }
}
exports.DigestInfo = DigestInfo;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_x509_1.AlgorithmIdentifier })
], DigestInfo.prototype, "digestAlgorithm", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.OctetString })
], DigestInfo.prototype, "digest", void 0);
