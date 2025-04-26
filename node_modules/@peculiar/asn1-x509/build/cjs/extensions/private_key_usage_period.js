"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrivateKeyUsagePeriod = exports.id_ce_privateKeyUsagePeriod = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const object_identifiers_1 = require("../object_identifiers");
exports.id_ce_privateKeyUsagePeriod = `${object_identifiers_1.id_ce}.16`;
class PrivateKeyUsagePeriod {
    constructor(params = {}) {
        Object.assign(this, params);
    }
}
exports.PrivateKeyUsagePeriod = PrivateKeyUsagePeriod;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.GeneralizedTime, context: 0, implicit: true, optional: true })
], PrivateKeyUsagePeriod.prototype, "notBefore", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.GeneralizedTime, context: 1, implicit: true, optional: true })
], PrivateKeyUsagePeriod.prototype, "notAfter", void 0);
