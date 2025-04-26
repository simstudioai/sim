"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthorityKeyIdentifier = exports.KeyIdentifier = exports.id_ce_authorityKeyIdentifier = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const general_name_1 = require("../general_name");
const object_identifiers_1 = require("../object_identifiers");
exports.id_ce_authorityKeyIdentifier = `${object_identifiers_1.id_ce}.35`;
class KeyIdentifier extends asn1_schema_1.OctetString {
}
exports.KeyIdentifier = KeyIdentifier;
class AuthorityKeyIdentifier {
    constructor(params = {}) {
        if (params) {
            Object.assign(this, params);
        }
    }
}
exports.AuthorityKeyIdentifier = AuthorityKeyIdentifier;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: KeyIdentifier, context: 0, optional: true, implicit: true })
], AuthorityKeyIdentifier.prototype, "keyIdentifier", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: general_name_1.GeneralName, context: 1, optional: true, implicit: true, repeated: "sequence" })
], AuthorityKeyIdentifier.prototype, "authorityCertIssuer", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({
        type: asn1_schema_1.AsnPropTypes.Integer,
        context: 2,
        optional: true,
        implicit: true,
        converter: asn1_schema_1.AsnIntegerArrayBufferConverter,
    })
], AuthorityKeyIdentifier.prototype, "authorityCertSerialNumber", void 0);
