"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ECPrivateKey = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const ec_parameters_1 = require("./ec_parameters");
class ECPrivateKey {
    constructor(params = {}) {
        this.version = 1;
        this.privateKey = new asn1_schema_1.OctetString();
        Object.assign(this, params);
    }
}
exports.ECPrivateKey = ECPrivateKey;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Integer })
], ECPrivateKey.prototype, "version", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.OctetString })
], ECPrivateKey.prototype, "privateKey", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: ec_parameters_1.ECParameters, context: 0, optional: true })
], ECPrivateKey.prototype, "parameters", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.BitString, context: 1, optional: true })
], ECPrivateKey.prototype, "publicKey", void 0);
