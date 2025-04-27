"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RSAES_OAEP = exports.RsaEsOaepParams = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const asn1_x509_1 = require("@peculiar/asn1-x509");
const object_identifiers_1 = require("../object_identifiers");
const algorithms_1 = require("../algorithms");
class RsaEsOaepParams {
    constructor(params = {}) {
        this.hashAlgorithm = new asn1_x509_1.AlgorithmIdentifier(algorithms_1.sha1);
        this.maskGenAlgorithm = new asn1_x509_1.AlgorithmIdentifier({
            algorithm: object_identifiers_1.id_mgf1,
            parameters: asn1_schema_1.AsnConvert.serialize(algorithms_1.sha1),
        });
        this.pSourceAlgorithm = new asn1_x509_1.AlgorithmIdentifier(algorithms_1.pSpecifiedEmpty);
        Object.assign(this, params);
    }
}
exports.RsaEsOaepParams = RsaEsOaepParams;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_x509_1.AlgorithmIdentifier, context: 0, defaultValue: algorithms_1.sha1 })
], RsaEsOaepParams.prototype, "hashAlgorithm", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_x509_1.AlgorithmIdentifier, context: 1, defaultValue: algorithms_1.mgf1SHA1 })
], RsaEsOaepParams.prototype, "maskGenAlgorithm", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_x509_1.AlgorithmIdentifier, context: 2, defaultValue: algorithms_1.pSpecifiedEmpty })
], RsaEsOaepParams.prototype, "pSourceAlgorithm", void 0);
exports.RSAES_OAEP = new asn1_x509_1.AlgorithmIdentifier({
    algorithm: object_identifiers_1.id_RSAES_OAEP,
    parameters: asn1_schema_1.AsnConvert.serialize(new RsaEsOaepParams()),
});
