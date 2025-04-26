"use strict";
var PolicyMappings_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolicyMappings = exports.PolicyMapping = exports.id_ce_policyMappings = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const object_identifiers_1 = require("../object_identifiers");
exports.id_ce_policyMappings = `${object_identifiers_1.id_ce}.33`;
class PolicyMapping {
    constructor(params = {}) {
        this.issuerDomainPolicy = "";
        this.subjectDomainPolicy = "";
        Object.assign(this, params);
    }
}
exports.PolicyMapping = PolicyMapping;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.ObjectIdentifier })
], PolicyMapping.prototype, "issuerDomainPolicy", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.ObjectIdentifier })
], PolicyMapping.prototype, "subjectDomainPolicy", void 0);
let PolicyMappings = PolicyMappings_1 = class PolicyMappings extends asn1_schema_1.AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, PolicyMappings_1.prototype);
    }
};
exports.PolicyMappings = PolicyMappings;
exports.PolicyMappings = PolicyMappings = PolicyMappings_1 = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Sequence, itemType: PolicyMapping })
], PolicyMappings);
