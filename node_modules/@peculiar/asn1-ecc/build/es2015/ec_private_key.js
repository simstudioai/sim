import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes, OctetString } from "@peculiar/asn1-schema";
import { ECParameters } from "./ec_parameters";
export class ECPrivateKey {
    constructor(params = {}) {
        this.version = 1;
        this.privateKey = new OctetString();
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: AsnPropTypes.Integer })
], ECPrivateKey.prototype, "version", void 0);
__decorate([
    AsnProp({ type: OctetString })
], ECPrivateKey.prototype, "privateKey", void 0);
__decorate([
    AsnProp({ type: ECParameters, context: 0, optional: true })
], ECPrivateKey.prototype, "parameters", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.BitString, context: 1, optional: true })
], ECPrivateKey.prototype, "publicKey", void 0);
