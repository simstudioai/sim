"use strict";
var ExtendedKeyUsage_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.id_kp_OCSPSigning = exports.id_kp_timeStamping = exports.id_kp_emailProtection = exports.id_kp_codeSigning = exports.id_kp_clientAuth = exports.id_kp_serverAuth = exports.anyExtendedKeyUsage = exports.ExtendedKeyUsage = exports.id_ce_extKeyUsage = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const object_identifiers_1 = require("../object_identifiers");
exports.id_ce_extKeyUsage = `${object_identifiers_1.id_ce}.37`;
let ExtendedKeyUsage = ExtendedKeyUsage_1 = class ExtendedKeyUsage extends asn1_schema_1.AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, ExtendedKeyUsage_1.prototype);
    }
};
exports.ExtendedKeyUsage = ExtendedKeyUsage;
exports.ExtendedKeyUsage = ExtendedKeyUsage = ExtendedKeyUsage_1 = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Sequence, itemType: asn1_schema_1.AsnPropTypes.ObjectIdentifier })
], ExtendedKeyUsage);
exports.anyExtendedKeyUsage = `${exports.id_ce_extKeyUsage}.0`;
exports.id_kp_serverAuth = `${object_identifiers_1.id_kp}.1`;
exports.id_kp_clientAuth = `${object_identifiers_1.id_kp}.2`;
exports.id_kp_codeSigning = `${object_identifiers_1.id_kp}.3`;
exports.id_kp_emailProtection = `${object_identifiers_1.id_kp}.4`;
exports.id_kp_timeStamping = `${object_identifiers_1.id_kp}.8`;
exports.id_kp_OCSPSigning = `${object_identifiers_1.id_kp}.9`;
