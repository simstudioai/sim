"use strict";
var FreshestCRL_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FreshestCRL = exports.id_ce_freshestCRL = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const object_identifiers_1 = require("../object_identifiers");
const crl_distribution_points_1 = require("./crl_distribution_points");
exports.id_ce_freshestCRL = `${object_identifiers_1.id_ce}.46`;
let FreshestCRL = FreshestCRL_1 = class FreshestCRL extends crl_distribution_points_1.CRLDistributionPoints {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, FreshestCRL_1.prototype);
    }
};
exports.FreshestCRL = FreshestCRL;
exports.FreshestCRL = FreshestCRL = FreshestCRL_1 = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Sequence, itemType: crl_distribution_points_1.DistributionPoint })
], FreshestCRL);
