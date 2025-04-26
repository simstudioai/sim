"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeneralName = exports.EDIPartyName = exports.OtherName = exports.AsnIpConverter = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const ip_converter_1 = require("./ip_converter");
const name_1 = require("./name");
exports.AsnIpConverter = {
    fromASN: (value) => ip_converter_1.IpConverter.toString(asn1_schema_1.AsnOctetStringConverter.fromASN(value)),
    toASN: (value) => asn1_schema_1.AsnOctetStringConverter.toASN(ip_converter_1.IpConverter.fromString(value)),
};
class OtherName {
    constructor(params = {}) {
        this.typeId = "";
        this.value = new ArrayBuffer(0);
        Object.assign(this, params);
    }
}
exports.OtherName = OtherName;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.ObjectIdentifier })
], OtherName.prototype, "typeId", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Any, context: 0 })
], OtherName.prototype, "value", void 0);
class EDIPartyName {
    constructor(params = {}) {
        this.partyName = new name_1.DirectoryString();
        Object.assign(this, params);
    }
}
exports.EDIPartyName = EDIPartyName;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: name_1.DirectoryString, optional: true, context: 0, implicit: true })
], EDIPartyName.prototype, "nameAssigner", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: name_1.DirectoryString, context: 1, implicit: true })
], EDIPartyName.prototype, "partyName", void 0);
let GeneralName = class GeneralName {
    constructor(params = {}) {
        Object.assign(this, params);
    }
};
exports.GeneralName = GeneralName;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: OtherName, context: 0, implicit: true })
], GeneralName.prototype, "otherName", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.IA5String, context: 1, implicit: true })
], GeneralName.prototype, "rfc822Name", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.IA5String, context: 2, implicit: true })
], GeneralName.prototype, "dNSName", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Any, context: 3, implicit: true })
], GeneralName.prototype, "x400Address", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: name_1.Name, context: 4, implicit: false })
], GeneralName.prototype, "directoryName", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: EDIPartyName, context: 5 })
], GeneralName.prototype, "ediPartyName", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.IA5String, context: 6, implicit: true })
], GeneralName.prototype, "uniformResourceIdentifier", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({
        type: asn1_schema_1.AsnPropTypes.OctetString,
        context: 7,
        implicit: true,
        converter: exports.AsnIpConverter,
    })
], GeneralName.prototype, "iPAddress", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.ObjectIdentifier, context: 8, implicit: true })
], GeneralName.prototype, "registeredID", void 0);
exports.GeneralName = GeneralName = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Choice })
], GeneralName);
