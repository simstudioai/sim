"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Validity = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
const time_1 = require("./time");
class Validity {
    constructor(params) {
        this.notBefore = new time_1.Time(new Date());
        this.notAfter = new time_1.Time(new Date());
        if (params) {
            this.notBefore = new time_1.Time(params.notBefore);
            this.notAfter = new time_1.Time(params.notAfter);
        }
    }
}
exports.Validity = Validity;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: time_1.Time })
], Validity.prototype, "notBefore", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({ type: time_1.Time })
], Validity.prototype, "notAfter", void 0);
