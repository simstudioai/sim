var IntegerSet_1;
import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes, AsnArray, AsnType, AsnTypeTypes, OctetString, } from "@peculiar/asn1-schema";
export const id_ce_keyDescription = "1.3.6.1.4.1.11129.2.1.17";
export var VerifiedBootState;
(function (VerifiedBootState) {
    VerifiedBootState[VerifiedBootState["verified"] = 0] = "verified";
    VerifiedBootState[VerifiedBootState["selfSigned"] = 1] = "selfSigned";
    VerifiedBootState[VerifiedBootState["unverified"] = 2] = "unverified";
    VerifiedBootState[VerifiedBootState["failed"] = 3] = "failed";
})(VerifiedBootState || (VerifiedBootState = {}));
export class RootOfTrust {
    constructor(params = {}) {
        this.verifiedBootKey = new OctetString();
        this.deviceLocked = false;
        this.verifiedBootState = VerifiedBootState.verified;
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: OctetString })
], RootOfTrust.prototype, "verifiedBootKey", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Boolean })
], RootOfTrust.prototype, "deviceLocked", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Enumerated })
], RootOfTrust.prototype, "verifiedBootState", void 0);
__decorate([
    AsnProp({ type: OctetString, optional: true })
], RootOfTrust.prototype, "verifiedBootHash", void 0);
let IntegerSet = IntegerSet_1 = class IntegerSet extends AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, IntegerSet_1.prototype);
    }
};
IntegerSet = IntegerSet_1 = __decorate([
    AsnType({ type: AsnTypeTypes.Set, itemType: AsnPropTypes.Integer })
], IntegerSet);
export { IntegerSet };
export class AuthorizationList {
    constructor(params = {}) {
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ context: 1, type: IntegerSet, optional: true })
], AuthorizationList.prototype, "purpose", void 0);
__decorate([
    AsnProp({ context: 2, type: AsnPropTypes.Integer, optional: true })
], AuthorizationList.prototype, "algorithm", void 0);
__decorate([
    AsnProp({ context: 3, type: AsnPropTypes.Integer, optional: true })
], AuthorizationList.prototype, "keySize", void 0);
__decorate([
    AsnProp({ context: 5, type: IntegerSet, optional: true })
], AuthorizationList.prototype, "digest", void 0);
__decorate([
    AsnProp({ context: 6, type: IntegerSet, optional: true })
], AuthorizationList.prototype, "padding", void 0);
__decorate([
    AsnProp({ context: 10, type: AsnPropTypes.Integer, optional: true })
], AuthorizationList.prototype, "ecCurve", void 0);
__decorate([
    AsnProp({ context: 200, type: AsnPropTypes.Integer, optional: true })
], AuthorizationList.prototype, "rsaPublicExponent", void 0);
__decorate([
    AsnProp({ context: 203, type: IntegerSet, optional: true })
], AuthorizationList.prototype, "mgfDigest", void 0);
__decorate([
    AsnProp({ context: 303, type: AsnPropTypes.Null, optional: true })
], AuthorizationList.prototype, "rollbackResistance", void 0);
__decorate([
    AsnProp({ context: 305, type: AsnPropTypes.Null, optional: true })
], AuthorizationList.prototype, "earlyBootOnly", void 0);
__decorate([
    AsnProp({ context: 400, type: AsnPropTypes.Integer, optional: true })
], AuthorizationList.prototype, "activeDateTime", void 0);
__decorate([
    AsnProp({ context: 401, type: AsnPropTypes.Integer, optional: true })
], AuthorizationList.prototype, "originationExpireDateTime", void 0);
__decorate([
    AsnProp({ context: 402, type: AsnPropTypes.Integer, optional: true })
], AuthorizationList.prototype, "usageExpireDateTime", void 0);
__decorate([
    AsnProp({ context: 405, type: AsnPropTypes.Integer, optional: true })
], AuthorizationList.prototype, "usageCountLimit", void 0);
__decorate([
    AsnProp({ context: 503, type: AsnPropTypes.Null, optional: true })
], AuthorizationList.prototype, "noAuthRequired", void 0);
__decorate([
    AsnProp({ context: 504, type: AsnPropTypes.Integer, optional: true })
], AuthorizationList.prototype, "userAuthType", void 0);
__decorate([
    AsnProp({ context: 505, type: AsnPropTypes.Integer, optional: true })
], AuthorizationList.prototype, "authTimeout", void 0);
__decorate([
    AsnProp({ context: 506, type: AsnPropTypes.Null, optional: true })
], AuthorizationList.prototype, "allowWhileOnBody", void 0);
__decorate([
    AsnProp({ context: 507, type: AsnPropTypes.Null, optional: true })
], AuthorizationList.prototype, "trustedUserPresenceRequired", void 0);
__decorate([
    AsnProp({ context: 508, type: AsnPropTypes.Null, optional: true })
], AuthorizationList.prototype, "trustedConfirmationRequired", void 0);
__decorate([
    AsnProp({ context: 509, type: AsnPropTypes.Null, optional: true })
], AuthorizationList.prototype, "unlockedDeviceRequired", void 0);
__decorate([
    AsnProp({ context: 600, type: AsnPropTypes.Null, optional: true })
], AuthorizationList.prototype, "allApplications", void 0);
__decorate([
    AsnProp({ context: 601, type: OctetString, optional: true })
], AuthorizationList.prototype, "applicationId", void 0);
__decorate([
    AsnProp({ context: 701, type: AsnPropTypes.Integer, optional: true })
], AuthorizationList.prototype, "creationDateTime", void 0);
__decorate([
    AsnProp({ context: 702, type: AsnPropTypes.Integer, optional: true })
], AuthorizationList.prototype, "origin", void 0);
__decorate([
    AsnProp({ context: 703, type: AsnPropTypes.Null, optional: true })
], AuthorizationList.prototype, "rollbackResistant", void 0);
__decorate([
    AsnProp({ context: 704, type: RootOfTrust, optional: true })
], AuthorizationList.prototype, "rootOfTrust", void 0);
__decorate([
    AsnProp({ context: 705, type: AsnPropTypes.Integer, optional: true })
], AuthorizationList.prototype, "osVersion", void 0);
__decorate([
    AsnProp({ context: 706, type: AsnPropTypes.Integer, optional: true })
], AuthorizationList.prototype, "osPatchLevel", void 0);
__decorate([
    AsnProp({ context: 709, type: OctetString, optional: true })
], AuthorizationList.prototype, "attestationApplicationId", void 0);
__decorate([
    AsnProp({ context: 710, type: OctetString, optional: true })
], AuthorizationList.prototype, "attestationIdBrand", void 0);
__decorate([
    AsnProp({ context: 711, type: OctetString, optional: true })
], AuthorizationList.prototype, "attestationIdDevice", void 0);
__decorate([
    AsnProp({ context: 712, type: OctetString, optional: true })
], AuthorizationList.prototype, "attestationIdProduct", void 0);
__decorate([
    AsnProp({ context: 713, type: OctetString, optional: true })
], AuthorizationList.prototype, "attestationIdSerial", void 0);
__decorate([
    AsnProp({ context: 714, type: OctetString, optional: true })
], AuthorizationList.prototype, "attestationIdImei", void 0);
__decorate([
    AsnProp({ context: 715, type: OctetString, optional: true })
], AuthorizationList.prototype, "attestationIdMeid", void 0);
__decorate([
    AsnProp({ context: 716, type: OctetString, optional: true })
], AuthorizationList.prototype, "attestationIdManufacturer", void 0);
__decorate([
    AsnProp({ context: 717, type: OctetString, optional: true })
], AuthorizationList.prototype, "attestationIdModel", void 0);
__decorate([
    AsnProp({ context: 718, type: AsnPropTypes.Integer, optional: true })
], AuthorizationList.prototype, "vendorPatchLevel", void 0);
__decorate([
    AsnProp({ context: 719, type: AsnPropTypes.Integer, optional: true })
], AuthorizationList.prototype, "bootPatchLevel", void 0);
__decorate([
    AsnProp({ context: 720, type: AsnPropTypes.Null, optional: true })
], AuthorizationList.prototype, "deviceUniqueAttestation", void 0);
__decorate([
    AsnProp({ context: 723, type: OctetString, optional: true })
], AuthorizationList.prototype, "attestationIdSecondImei", void 0);
__decorate([
    AsnProp({ context: 724, type: OctetString, optional: true })
], AuthorizationList.prototype, "moduleHash", void 0);
export var SecurityLevel;
(function (SecurityLevel) {
    SecurityLevel[SecurityLevel["software"] = 0] = "software";
    SecurityLevel[SecurityLevel["trustedEnvironment"] = 1] = "trustedEnvironment";
    SecurityLevel[SecurityLevel["strongBox"] = 2] = "strongBox";
})(SecurityLevel || (SecurityLevel = {}));
export var Version;
(function (Version) {
    Version[Version["KM2"] = 1] = "KM2";
    Version[Version["KM3"] = 2] = "KM3";
    Version[Version["KM4"] = 3] = "KM4";
    Version[Version["KM4_1"] = 4] = "KM4_1";
    Version[Version["keyMint1"] = 100] = "keyMint1";
    Version[Version["keyMint2"] = 200] = "keyMint2";
    Version[Version["keyMint3"] = 300] = "keyMint3";
    Version[Version["keyMint4"] = 400] = "keyMint4";
})(Version || (Version = {}));
export class KeyDescription {
    constructor(params = {}) {
        this.attestationVersion = Version.KM4;
        this.attestationSecurityLevel = SecurityLevel.software;
        this.keymasterVersion = 0;
        this.keymasterSecurityLevel = SecurityLevel.software;
        this.attestationChallenge = new OctetString();
        this.uniqueId = new OctetString();
        this.softwareEnforced = new AuthorizationList();
        this.teeEnforced = new AuthorizationList();
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: AsnPropTypes.Integer })
], KeyDescription.prototype, "attestationVersion", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Enumerated })
], KeyDescription.prototype, "attestationSecurityLevel", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Integer })
], KeyDescription.prototype, "keymasterVersion", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Enumerated })
], KeyDescription.prototype, "keymasterSecurityLevel", void 0);
__decorate([
    AsnProp({ type: OctetString })
], KeyDescription.prototype, "attestationChallenge", void 0);
__decorate([
    AsnProp({ type: OctetString })
], KeyDescription.prototype, "uniqueId", void 0);
__decorate([
    AsnProp({ type: AuthorizationList })
], KeyDescription.prototype, "softwareEnforced", void 0);
__decorate([
    AsnProp({ type: AuthorizationList })
], KeyDescription.prototype, "teeEnforced", void 0);
export class KeyMintKeyDescription {
    constructor(params = {}) {
        this.attestationVersion = Version.keyMint4;
        this.attestationSecurityLevel = SecurityLevel.software;
        this.keyMintVersion = 0;
        this.keyMintSecurityLevel = SecurityLevel.software;
        this.attestationChallenge = new OctetString();
        this.uniqueId = new OctetString();
        this.softwareEnforced = new AuthorizationList();
        this.hardwareEnforced = new AuthorizationList();
        Object.assign(this, params);
    }
    toLegacyKeyDescription() {
        return new KeyDescription({
            attestationVersion: this.attestationVersion,
            attestationSecurityLevel: this.attestationSecurityLevel,
            keymasterVersion: this.keyMintVersion,
            keymasterSecurityLevel: this.keyMintSecurityLevel,
            attestationChallenge: this.attestationChallenge,
            uniqueId: this.uniqueId,
            softwareEnforced: this.softwareEnforced,
            teeEnforced: this.hardwareEnforced,
        });
    }
    static fromLegacyKeyDescription(keyDesc) {
        return new KeyMintKeyDescription({
            attestationVersion: keyDesc.attestationVersion,
            attestationSecurityLevel: keyDesc.attestationSecurityLevel,
            keyMintVersion: keyDesc.keymasterVersion,
            keyMintSecurityLevel: keyDesc.keymasterSecurityLevel,
            attestationChallenge: keyDesc.attestationChallenge,
            uniqueId: keyDesc.uniqueId,
            softwareEnforced: keyDesc.softwareEnforced,
            hardwareEnforced: keyDesc.teeEnforced,
        });
    }
}
__decorate([
    AsnProp({ type: AsnPropTypes.Integer })
], KeyMintKeyDescription.prototype, "attestationVersion", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Enumerated })
], KeyMintKeyDescription.prototype, "attestationSecurityLevel", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Integer })
], KeyMintKeyDescription.prototype, "keyMintVersion", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Enumerated })
], KeyMintKeyDescription.prototype, "keyMintSecurityLevel", void 0);
__decorate([
    AsnProp({ type: OctetString })
], KeyMintKeyDescription.prototype, "attestationChallenge", void 0);
__decorate([
    AsnProp({ type: OctetString })
], KeyMintKeyDescription.prototype, "uniqueId", void 0);
__decorate([
    AsnProp({ type: AuthorizationList })
], KeyMintKeyDescription.prototype, "softwareEnforced", void 0);
__decorate([
    AsnProp({ type: AuthorizationList })
], KeyMintKeyDescription.prototype, "hardwareEnforced", void 0);
