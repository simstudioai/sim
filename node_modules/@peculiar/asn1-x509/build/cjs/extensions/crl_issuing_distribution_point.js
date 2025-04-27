"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IssuingDistributionPoint = exports.id_ce_issuingDistributionPoint = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const crl_distribution_points_1 = require("./crl_distribution_points");
const object_identifiers_1 = require("../object_identifiers");
const asn1_schema_2 = require("@peculiar/asn1-schema");
exports.id_ce_issuingDistributionPoint = `${object_identifiers_1.id_ce}.28`;
class IssuingDistributionPoint {
    constructor(params = {}) {
        this.onlyContainsUserCerts = IssuingDistributionPoint.ONLY;
        this.onlyContainsCACerts = IssuingDistributionPoint.ONLY;
        this.indirectCRL = IssuingDistributionPoint.ONLY;
        this.onlyContainsAttributeCerts = IssuingDistributionPoint.ONLY;
        Object.assign(this, params);
    }
}
exports.IssuingDistributionPoint = IssuingDistributionPoint;
IssuingDistributionPoint.ONLY = false;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: crl_distribution_points_1.DistributionPointName, context: 0, optional: true })
], IssuingDistributionPoint.prototype, "distributionPoint", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({
        type: asn1_schema_2.AsnPropTypes.Boolean,
        context: 1,
        defaultValue: IssuingDistributionPoint.ONLY,
        implicit: true,
    })
], IssuingDistributionPoint.prototype, "onlyContainsUserCerts", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({
        type: asn1_schema_2.AsnPropTypes.Boolean,
        context: 2,
        defaultValue: IssuingDistributionPoint.ONLY,
        implicit: true,
    })
], IssuingDistributionPoint.prototype, "onlyContainsCACerts", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: crl_distribution_points_1.Reason, context: 3, optional: true, implicit: true })
], IssuingDistributionPoint.prototype, "onlySomeReasons", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({
        type: asn1_schema_2.AsnPropTypes.Boolean,
        context: 4,
        defaultValue: IssuingDistributionPoint.ONLY,
        implicit: true,
    })
], IssuingDistributionPoint.prototype, "indirectCRL", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({
        type: asn1_schema_2.AsnPropTypes.Boolean,
        context: 5,
        defaultValue: IssuingDistributionPoint.ONLY,
        implicit: true,
    })
], IssuingDistributionPoint.prototype, "onlyContainsAttributeCerts", void 0);
