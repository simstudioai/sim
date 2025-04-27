"use strict";
var RelativeDistinguishedName_1, RDNSequence_1, Name_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.Name = exports.RDNSequence = exports.RelativeDistinguishedName = exports.AttributeTypeAndValue = exports.AttributeValue = exports.DirectoryString = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const pvtsutils_1 = require("pvtsutils");
let DirectoryString = class DirectoryString {
    constructor(params = {}) {
        Object.assign(this, params);
    }
    toString() {
        return (this.bmpString ||
            this.printableString ||
            this.teletexString ||
            this.universalString ||
            this.utf8String ||
            "");
    }
};
exports.DirectoryString = DirectoryString;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.TeletexString })
], DirectoryString.prototype, "teletexString", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.PrintableString })
], DirectoryString.prototype, "printableString", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.UniversalString })
], DirectoryString.prototype, "universalString", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Utf8String })
], DirectoryString.prototype, "utf8String", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.BmpString })
], DirectoryString.prototype, "bmpString", void 0);
exports.DirectoryString = DirectoryString = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Choice })
], DirectoryString);
let AttributeValue = class AttributeValue extends DirectoryString {
    constructor(params = {}) {
        super(params);
        Object.assign(this, params);
    }
    toString() {
        return this.ia5String || (this.anyValue ? pvtsutils_1.Convert.ToHex(this.anyValue) : super.toString());
    }
};
exports.AttributeValue = AttributeValue;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.IA5String })
], AttributeValue.prototype, "ia5String", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Any })
], AttributeValue.prototype, "anyValue", void 0);
exports.AttributeValue = AttributeValue = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Choice })
], AttributeValue);
class AttributeTypeAndValue {
    constructor(params = {}) {
        this.type = "";
        this.value = new AttributeValue();
        Object.assign(this, params);
    }
}
exports.AttributeTypeAndValue = AttributeTypeAndValue;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.ObjectIdentifier })
], AttributeTypeAndValue.prototype, "type", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: AttributeValue })
], AttributeTypeAndValue.prototype, "value", void 0);
let RelativeDistinguishedName = RelativeDistinguishedName_1 = class RelativeDistinguishedName extends asn1_schema_1.AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, RelativeDistinguishedName_1.prototype);
    }
};
exports.RelativeDistinguishedName = RelativeDistinguishedName;
exports.RelativeDistinguishedName = RelativeDistinguishedName = RelativeDistinguishedName_1 = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Set, itemType: AttributeTypeAndValue })
], RelativeDistinguishedName);
let RDNSequence = RDNSequence_1 = class RDNSequence extends asn1_schema_1.AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, RDNSequence_1.prototype);
    }
};
exports.RDNSequence = RDNSequence;
exports.RDNSequence = RDNSequence = RDNSequence_1 = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Sequence, itemType: RelativeDistinguishedName })
], RDNSequence);
let Name = Name_1 = class Name extends RDNSequence {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, Name_1.prototype);
    }
};
exports.Name = Name;
exports.Name = Name = Name_1 = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Sequence })
], Name);
