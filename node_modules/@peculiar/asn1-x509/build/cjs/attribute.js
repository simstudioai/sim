"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Attribute = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
class Attribute {
    constructor(params = {}) {
        this.type = "";
        this.values = [];
        Object.assign(this, params);
    }
}
exports.Attribute = Attribute;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.ObjectIdentifier })
], Attribute.prototype, "type", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.Any, repeated: "set" })
], Attribute.prototype, "values", void 0);
