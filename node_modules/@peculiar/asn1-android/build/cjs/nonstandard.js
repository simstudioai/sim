"use strict";
var NonStandardAuthorizationList_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NonStandardKeyMintKeyDescription = exports.NonStandardKeyDescription = exports.NonStandardAuthorizationList = exports.NonStandardAuthorization = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const key_description_1 = require("./key_description");
let NonStandardAuthorization = class NonStandardAuthorization extends key_description_1.AuthorizationList {
};
exports.NonStandardAuthorization = NonStandardAuthorization;
exports.NonStandardAuthorization = NonStandardAuthorization = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Choice })
], NonStandardAuthorization);
let NonStandardAuthorizationList = NonStandardAuthorizationList_1 = class NonStandardAuthorizationList extends asn1_schema_1.AsnArray {
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
exports.NonStandardAuthorizationList = NonStandardAuthorizationList;
exports.NonStandardAuthorizationList = NonStandardAuthorizationList = NonStandardAuthorizationList_1 = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Sequence, itemType: NonStandardAuthorization })
], NonStandardAuthorizationList);
class NonStandardKeyDescription {
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
        this.attestationVersion = key_description_1.Version.KM4;
        this.attestationSecurityLevel = key_description_1.SecurityLevel.software;
        this.keymasterVersion = 0;
        this.keymasterSecurityLevel = key_description_1.SecurityLevel.software;
        this.attestationChallenge = new asn1_schema_1.OctetString();
        this.uniqueId = new asn1_schema_1.OctetString();
        this.softwareEnforced = new NonStandardAuthorizationList();
        this.teeEnforced = new NonStandardAuthorizationList();
        Object.assign(this, params);
    }
}
exports.NonStandardKeyDescription = NonStandardKeyDescription;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Integer })
], NonStandardKeyDescription.prototype, "attestationVersion", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Enumerated })
], NonStandardKeyDescription.prototype, "attestationSecurityLevel", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Integer })
], NonStandardKeyDescription.prototype, "keymasterVersion", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Enumerated })
], NonStandardKeyDescription.prototype, "keymasterSecurityLevel", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.OctetString })
], NonStandardKeyDescription.prototype, "attestationChallenge", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.OctetString })
], NonStandardKeyDescription.prototype, "uniqueId", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: NonStandardAuthorizationList })
], NonStandardKeyDescription.prototype, "softwareEnforced", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: NonStandardAuthorizationList })
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
exports.NonStandardKeyMintKeyDescription = NonStandardKeyMintKeyDescription;
exports.NonStandardKeyMintKeyDescription = NonStandardKeyMintKeyDescription = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Sequence })
], NonStandardKeyMintKeyDescription);
