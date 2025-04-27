"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EntrustVersionInfo = exports.EntrustInfo = exports.EntrustInfoFlags = exports.id_entrust_entrustVersInfo = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
exports.id_entrust_entrustVersInfo = "1.2.840.113533.7.65.0";
var EntrustInfoFlags;
(function (EntrustInfoFlags) {
    EntrustInfoFlags[EntrustInfoFlags["keyUpdateAllowed"] = 1] = "keyUpdateAllowed";
    EntrustInfoFlags[EntrustInfoFlags["newExtensions"] = 2] = "newExtensions";
    EntrustInfoFlags[EntrustInfoFlags["pKIXCertificate"] = 4] = "pKIXCertificate";
})(EntrustInfoFlags || (exports.EntrustInfoFlags = EntrustInfoFlags = {}));
class EntrustInfo extends asn1_schema_1.BitString {
    toJSON() {
        const res = [];
        const flags = this.toNumber();
        if (flags & EntrustInfoFlags.pKIXCertificate) {
            res.push("pKIXCertificate");
        }
        if (flags & EntrustInfoFlags.newExtensions) {
            res.push("newExtensions");
        }
        if (flags & EntrustInfoFlags.keyUpdateAllowed) {
            res.push("keyUpdateAllowed");
        }
        return res;
    }
    toString() {
        return `[${this.toJSON().join(", ")}]`;
    }
}
exports.EntrustInfo = EntrustInfo;
class EntrustVersionInfo {
    constructor(params = {}) {
        this.entrustVers = "";
        this.entrustInfoFlags = new EntrustInfo();
        Object.assign(this, params);
    }
}
exports.EntrustVersionInfo = EntrustVersionInfo;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.GeneralString })
], EntrustVersionInfo.prototype, "entrustVers", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: EntrustInfo })
], EntrustVersionInfo.prototype, "entrustInfoFlags", void 0);
