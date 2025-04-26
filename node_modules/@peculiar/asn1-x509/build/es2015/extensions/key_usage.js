import { BitString } from "@peculiar/asn1-schema";
import { id_ce } from "../object_identifiers";
export const id_ce_keyUsage = `${id_ce}.15`;
export var KeyUsageFlags;
(function (KeyUsageFlags) {
    KeyUsageFlags[KeyUsageFlags["digitalSignature"] = 1] = "digitalSignature";
    KeyUsageFlags[KeyUsageFlags["nonRepudiation"] = 2] = "nonRepudiation";
    KeyUsageFlags[KeyUsageFlags["keyEncipherment"] = 4] = "keyEncipherment";
    KeyUsageFlags[KeyUsageFlags["dataEncipherment"] = 8] = "dataEncipherment";
    KeyUsageFlags[KeyUsageFlags["keyAgreement"] = 16] = "keyAgreement";
    KeyUsageFlags[KeyUsageFlags["keyCertSign"] = 32] = "keyCertSign";
    KeyUsageFlags[KeyUsageFlags["cRLSign"] = 64] = "cRLSign";
    KeyUsageFlags[KeyUsageFlags["encipherOnly"] = 128] = "encipherOnly";
    KeyUsageFlags[KeyUsageFlags["decipherOnly"] = 256] = "decipherOnly";
})(KeyUsageFlags || (KeyUsageFlags = {}));
export class KeyUsage extends BitString {
    toJSON() {
        const flag = this.toNumber();
        const res = [];
        if (flag & KeyUsageFlags.cRLSign) {
            res.push("crlSign");
        }
        if (flag & KeyUsageFlags.dataEncipherment) {
            res.push("dataEncipherment");
        }
        if (flag & KeyUsageFlags.decipherOnly) {
            res.push("decipherOnly");
        }
        if (flag & KeyUsageFlags.digitalSignature) {
            res.push("digitalSignature");
        }
        if (flag & KeyUsageFlags.encipherOnly) {
            res.push("encipherOnly");
        }
        if (flag & KeyUsageFlags.keyAgreement) {
            res.push("keyAgreement");
        }
        if (flag & KeyUsageFlags.keyCertSign) {
            res.push("keyCertSign");
        }
        if (flag & KeyUsageFlags.keyEncipherment) {
            res.push("keyEncipherment");
        }
        if (flag & KeyUsageFlags.nonRepudiation) {
            res.push("nonRepudiation");
        }
        return res;
    }
    toString() {
        return `[${this.toJSON().join(", ")}]`;
    }
}
