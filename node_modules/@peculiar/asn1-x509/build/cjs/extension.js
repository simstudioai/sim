"use strict";
var Extensions_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.Extensions = exports.Extension = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
class Extension {
    constructor(params = {}) {
        this.extnID = "";
        this.critical = Extension.CRITICAL;
        this.extnValue = new asn1_schema_1.OctetString();
        Object.assign(this, params);
    }
}
exports.Extension = Extension;
Extension.CRITICAL = false;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.AsnPropTypes.ObjectIdentifier })
], Extension.prototype, "extnID", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({
        type: asn1_schema_1.AsnPropTypes.Boolean,
        defaultValue: Extension.CRITICAL,
    })
], Extension.prototype, "critical", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: asn1_schema_1.OctetString })
], Extension.prototype, "extnValue", void 0);
let Extensions = Extensions_1 = class Extensions extends asn1_schema_1.AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, Extensions_1.prototype);
    }
};
exports.Extensions = Extensions;
exports.Extensions = Extensions = Extensions_1 = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Sequence, itemType: Extension })
], Extensions);
