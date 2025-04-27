var NonStandardAuthorizationList_1;
import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes, AsnArray, AsnType, AsnTypeTypes, OctetString, } from "@peculiar/asn1-schema";
import { AuthorizationList, SecurityLevel, Version } from "./key_description";
let NonStandardAuthorization = class NonStandardAuthorization extends AuthorizationList {
};
NonStandardAuthorization = __decorate([
    AsnType({ type: AsnTypeTypes.Choice })
], NonStandardAuthorization);
export { NonStandardAuthorization };
let NonStandardAuthorizationList = NonStandardAuthorizationList_1 = class NonStandardAuthorizationList extends AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, NonStandardAuthorizationList_1.prototype);
    }
    findProperty(key) {
        const prop = this.find((o) => key in o);
        if (prop) {
            return prop[key];
        }
        return undefined;
    }
};
NonStandardAuthorizationList = NonStandardAuthorizationList_1 = __decorate([
    AsnType({ type: AsnTypeTypes.Sequence, itemType: NonStandardAuthorization })
], NonStandardAuthorizationList);
export { NonStandardAuthorizationList };
export class NonStandardKeyDescription {
    get keyMintVersion() {
        return this.keymasterVersion;
    }
    set keyMintVersion(value) {
        this.keymasterVersion = value;
    }
    get keyMintSecurityLevel() {
        return this.keymasterSecurityLevel;
    }
    set keyMintSecurityLevel(value) {
        this.keymasterSecurityLevel = value;
    }
    get hardwareEnforced() {
        return this.teeEnforced;
    }
    set hardwareEnforced(value) {
        this.teeEnforced = value;
    }
    constructor(params = {}) {
        this.attestationVersion = Version.KM4;
        this.attestationSecurityLevel = SecurityLevel.software;
        this.keymasterVersion = 0;
        this.keymasterSecurityLevel = SecurityLevel.software;
        this.attestationChallenge = new OctetString();
        this.uniqueId = new OctetString();
        this.softwareEnforced = new NonStandardAuthorizationList();
        this.teeEnforced = new NonStandardAuthorizationList();
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: AsnPropTypes.Integer })
], NonStandardKeyDescription.prototype, "attestationVersion", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Enumerated })
], NonStandardKeyDescription.prototype, "attestationSecurityLevel", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Integer })
], NonStandardKeyDescription.prototype, "keymasterVersion", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Enumerated })
], NonStandardKeyDescription.prototype, "keymasterSecurityLevel", void 0);
__decorate([
    AsnProp({ type: OctetString })
], NonStandardKeyDescription.prototype, "attestationChallenge", void 0);
__decorate([
    AsnProp({ type: OctetString })
], NonStandardKeyDescription.prototype, "uniqueId", void 0);
__decorate([
    AsnProp({ type: NonStandardAuthorizationList })
], NonStandardKeyDescription.prototype, "softwareEnforced", void 0);
__decorate([
    AsnProp({ type: NonStandardAuthorizationList })
], NonStandardKeyDescription.prototype, "teeEnforced", void 0);
let NonStandardKeyMintKeyDescription = class NonStandardKeyMintKeyDescription extends NonStandardKeyDescription {
    constructor(params = {}) {
        if ("keymasterVersion" in params && !("keyMintVersion" in params)) {
            params.keyMintVersion = params.keymasterVersion;
        }
        if ("keymasterSecurityLevel" in params && !("keyMintSecurityLevel" in params)) {
            params.keyMintSecurityLevel = params.keymasterSecurityLevel;
        }
        if ("teeEnforced" in params && !("hardwareEnforced" in params)) {
            params.hardwareEnforced = params.teeEnforced;
        }
        super(params);
    }
};
NonStandardKeyMintKeyDescription = __decorate([
    AsnType({ type: AsnTypeTypes.Sequence })
], NonStandardKeyMintKeyDescription);
export { NonStandardKeyMintKeyDescription };
