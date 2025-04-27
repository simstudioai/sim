"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AsnArray = void 0;
class AsnArray extends Array {
    constructor(items = []) {
        if (typeof items === "number") {
            super(items);
        }
        else {
            super();
            for (const item of items) {
                this.push(item);
            }
        }
    }
}
exports.AsnArray = AsnArray;
