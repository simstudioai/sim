"use strict";
var AuthorityInfoAccessSyntax_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthorityInfoAccessSyntax = exports.AccessDescription = exports.id_pe_authorityInfoAccess = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const general_name_1 = require("../general_name");
const object_identifiers_1 = require("../object_identifiers");
exports.id_pe_authorityInfoAccess = `${object_identifiers_1.id_pe}.1`;
class AccessDescription {
    constructor(params = {}) {
        this.accessMethod = "";
        this.accessLocation = new general_name_1.GeneralName();
        Object.assign(this, params);
    }
}
exports.AccessDescription = AccessDescription;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.ObjectIdentifier })
], AccessDescription.prototype, "accessMethod", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: general_name_1.GeneralName })
], AccessDescription.prototype, "accessLocation", void 0);
let AuthorityInfoAccessSyntax = AuthorityInfoAccessSyntax_1 = class AuthorityInfoAccessSyntax extends asn1_schema_1.AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, AuthorityInfoAccessSyntax_1.prototype);
    }
};
exports.AuthorityInfoAccessSyntax = AuthorityInfoAccessSyntax;
exports.AuthorityInfoAccessSyntax = AuthorityInfoAccessSyntax = AuthorityInfoAccessSyntax_1 = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Sequence, itemType: AccessDescription })
], AuthorityInfoAccessSyntax);
