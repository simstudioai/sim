var ExtendedKeyUsage_1;
import { __decorate } from "tslib";
import { AsnPropTypes, AsnArray, AsnType, AsnTypeTypes } from "@peculiar/asn1-schema";
import { id_ce, id_kp } from "../object_identifiers";
export const id_ce_extKeyUsage = `${id_ce}.37`;
let ExtendedKeyUsage = ExtendedKeyUsage_1 = class ExtendedKeyUsage extends AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, ExtendedKeyUsage_1.prototype);
    }
};
ExtendedKeyUsage = ExtendedKeyUsage_1 = __decorate([
    AsnType({ type: AsnTypeTypes.Sequence, itemType: AsnPropTypes.ObjectIdentifier })
], ExtendedKeyUsage);
export { ExtendedKeyUsage };
export const anyExtendedKeyUsage = `${id_ce_extKeyUsage}.0`;
export const id_kp_serverAuth = `${id_kp}.1`;
export const id_kp_clientAuth = `${id_kp}.2`;
export const id_kp_codeSigning = `${id_kp}.3`;
export const id_kp_emailProtection = `${id_kp}.4`;
export const id_kp_timeStamping = `${id_kp}.8`;
export const id_kp_OCSPSigning = `${id_kp}.9`;
