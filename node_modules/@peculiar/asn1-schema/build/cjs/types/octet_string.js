"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OctetString = void 0;
const asn1js = require("asn1js");
const pvtsutils_1 = require("pvtsutils");
class OctetString {
    get byteLength() {
        return this.buffer.byteLength;
    }
    get byteOffset() {
        return 0;
    }
    constructor(param) {
        if (typeof param === "number") {
            this.buffer = new ArrayBuffer(param);
        }
        else {
            if (pvtsutils_1.BufferSourceConverter.isBufferSource(param)) {
                this.buffer = pvtsutils_1.BufferSourceConverter.toArrayBuffer(param);
            }
            else if (Array.isArray(param)) {
                this.buffer = new Uint8Array(param);
            }
            else {
                this.buffer = new ArrayBuffer(0);
            }
        }
    }
    fromASN(asn) {
        if (!(asn instanceof asn1js.OctetString)) {
            throw new TypeError("Argument 'asn' is not instance of ASN.1 OctetString");
        }
        this.buffer = asn.valueBlock.valueHex;
        return this;
    }
    toASN() {
        return new asn1js.OctetString({ valueHex: this.buffer });
    }
    toSchema(name) {
        return new asn1js.OctetString({ name });
    }
}
exports.OctetString = OctetString;
