"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RSASSA_PSS = exports.RsaSaPssParams = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const asn1_x509_1 = require("@peculiar/asn1-x509");
const object_identifiers_1 = require("../object_identifiers");
const algorithms_1 = require("../algorithms");
class RsaSaPssParams {
    constructor(params = {}) {
        this.hashAlgorithm = new asn1_x509_1.AlgorithmIdentifier(algorithms_1.sha1);
        this.maskGenAlgorithm = new asn1_x509_1.AlgorithmIdentifier({
            algorithm: object_identifiers_1.id_mgf1,
            parameters: asn1_schema_1.AsnConvert.serialize(algorithms_1.sha1),
        });
        this.saltLength = 20;
        this.trailerField = 1;
        Object.assign(this, params);
    }
}
exports.RsaSaPssParams = RsaSaPssParams;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_x509_1.AlgorithmIdentifier, context: 0, defaultValue: algorithms_1.sha1 })
], RsaSaPssParams.prototype, "hashAlgorithm", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_x509_1.AlgorithmIdentifier, context: 1, defaultValue: algorithms_1.mgf1SHA1 })
], RsaSaPssParams.prototype, "maskGenAlgorithm", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Integer, context: 2, defaultValue: 20 })
], RsaSaPssParams.prototype, "saltLength", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Integer, context: 3, defaultValue: 1 })
], RsaSaPssParams.prototype, "trailerField", void 0);
exports.RSASSA_PSS = new asn1_x509_1.AlgorithmIdentifier({
    algorithm: object_identifiers_1.id_RSASSA_PSS,
    parameters: asn1_schema_1.AsnConvert.serialize(new RsaSaPssParams()),
});
