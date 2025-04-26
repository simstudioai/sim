"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TBSCertList = exports.RevokedCertificate = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const algorithm_identifier_1 = require("./algorithm_identifier");
const name_1 = require("./name");
const time_1 = require("./time");
const extension_1 = require("./extension");
class RevokedCertificate {
    constructor(params = {}) {
        this.userCertificate = new ArrayBuffer(0);
        this.revocationDate = new time_1.Time();
        Object.assign(this, params);
    }
}
exports.RevokedCertificate = RevokedCertificate;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Integer, converter: asn1_schema_1.AsnIntegerArrayBufferConverter })
], RevokedCertificate.prototype, "userCertificate", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: time_1.Time })
], RevokedCertificate.prototype, "revocationDate", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: extension_1.Extension, optional: true, repeated: "sequence" })
], RevokedCertificate.prototype, "crlEntryExtensions", void 0);
class TBSCertList {
    constructor(params = {}) {
        this.signature = new algorithm_identifier_1.AlgorithmIdentifier();
        this.issuer = new name_1.Name();
        this.thisUpdate = new time_1.Time();
        Object.assign(this, params);
    }
}
exports.TBSCertList = TBSCertList;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Integer, optional: true })
], TBSCertList.prototype, "version", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: algorithm_identifier_1.AlgorithmIdentifier })
], TBSCertList.prototype, "signature", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: name_1.Name })
], TBSCertList.prototype, "issuer", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: time_1.Time })
], TBSCertList.prototype, "thisUpdate", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: time_1.Time, optional: true })
], TBSCertList.prototype, "nextUpdate", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: RevokedCertificate, repeated: "sequence", optional: true })
], TBSCertList.prototype, "revokedCertificates", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: extension_1.Extension, optional: true, context: 0, repeated: "sequence" })
], TBSCertList.prototype, "crlExtensions", void 0);
