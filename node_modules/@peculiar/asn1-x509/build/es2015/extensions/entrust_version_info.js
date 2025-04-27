import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes, BitString } from "@peculiar/asn1-schema";
export const id_entrust_entrustVersInfo = "1.2.840.113533.7.65.0";
export var EntrustInfoFlags;
(function (EntrustInfoFlags) {
    EntrustInfoFlags[EntrustInfoFlags["keyUpdateAllowed"] = 1] = "keyUpdateAllowed";
    EntrustInfoFlags[EntrustInfoFlags["newExtensions"] = 2] = "newExtensions";
    EntrustInfoFlags[EntrustInfoFlags["pKIXCertificate"] = 4] = "pKIXCertificate";
})(EntrustInfoFlags || (EntrustInfoFlags = {}));
export class EntrustInfo extends BitString {
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
export class EntrustVersionInfo {
    constructor(params = {}) {
        this.entrustVers = "";
        this.entrustInfoFlags = new EntrustInfo();
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: AsnPropTypes.GeneralString })
], EntrustVersionInfo.prototype, "entrustVers", void 0);
__decorate([
    AsnProp({ type: EntrustInfo })
], EntrustVersionInfo.prototype, "entrustInfoFlags", void 0);
