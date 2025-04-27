import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes, AsnType, AsnTypeTypes } from "@peculiar/asn1-schema";
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
__decorate([
    AsnProp({
        type: AsnPropTypes.UTCTime,
    })
], Time.prototype, "utcTime", void 0);
__decorate([
    AsnProp({
        type: AsnPropTypes.GeneralizedTime,
    })
], Time.prototype, "generalTime", void 0);
Time = __decorate([
    AsnType({ type: AsnTypeTypes.Choice })
], Time);
export { Time };
