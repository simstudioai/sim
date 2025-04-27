"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Time = void 0;
const tslib_1 = require("tslib");
const asn1_schema_1 = require("@peculiar/asn1-schema");
let Time = class Time {
    constructor(time) {
        if (time) {
            if (typeof time === "string" || typeof time === "number" || time instanceof Date) {
                const date = new Date(time);
                if (date.getUTCFullYear() > 2049) {
                    this.generalTime = date;
                }
                else {
                    this.utcTime = date;
                }
            }
            else {
                Object.assign(this, time);
            }
        }
    }
    getTime() {
        const time = this.utcTime || this.generalTime;
        if (!time) {
            throw new Error("Cannot get time from CHOICE object");
        }
        return time;
    }
};
exports.Time = Time;
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({
        type: asn1_schema_1.AsnPropTypes.UTCTime,
    })
], Time.prototype, "utcTime", void 0);
tslib_1.__decorate([
    (0, asn1_schema_1.AsnProp)({
        type: asn1_schema_1.AsnPropTypes.GeneralizedTime,
    })
], Time.prototype, "generalTime", void 0);
exports.Time = Time = tslib_1.__decorate([
    (0, asn1_schema_1.AsnType)({ type: asn1_schema_1.AsnTypeTypes.Choice })
], Time);
