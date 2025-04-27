"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubjectPublicKeyInfo = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const algorithm_identifier_1 = require("./algorithm_identifier");
class SubjectPublicKeyInfo {
    constructor(params = {}) {
        this.algorithm = new algorithm_identifier_1.AlgorithmIdentifier();
        this.subjectPublicKey = new ArrayBuffer(0);
        Object.assign(this, params);
    }
}
exports.SubjectPublicKeyInfo = SubjectPublicKeyInfo;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: algorithm_identifier_1.AlgorithmIdentifier })
], SubjectPublicKeyInfo.prototype, "algorithm", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.BitString })
], SubjectPublicKeyInfo.prototype, "subjectPublicKey", void 0);
