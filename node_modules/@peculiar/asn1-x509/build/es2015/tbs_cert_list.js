import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes, AsnIntegerArrayBufferConverter } from "@peculiar/asn1-schema";
import { AlgorithmIdentifier } from "./algorithm_identifier";
import { Name } from "./name";
import { Time } from "./time";
import { Extension } from "./extension";
export class RevokedCertificate {
    constructor(params = {}) {
        this.userCertificate = new ArrayBuffer(0);
        this.revocationDate = new Time();
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: AsnPropTypes.Integer, converter: AsnIntegerArrayBufferConverter })
], RevokedCertificate.prototype, "userCertificate", void 0);
__decorate([
    AsnProp({ type: Time })
], RevokedCertificate.prototype, "revocationDate", void 0);
__decorate([
    AsnProp({ type: Extension, optional: true, repeated: "sequence" })
], RevokedCertificate.prototype, "crlEntryExtensions", void 0);
export class TBSCertList {
    constructor(params = {}) {
        this.signature = new AlgorithmIdentifier();
        this.issuer = new Name();
        this.thisUpdate = new Time();
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: AsnPropTypes.Integer, optional: true })
], TBSCertList.prototype, "version", void 0);
__decorate([
    AsnProp({ type: AlgorithmIdentifier })
], TBSCertList.prototype, "signature", void 0);
__decorate([
    AsnProp({ type: Name })
], TBSCertList.prototype, "issuer", void 0);
__decorate([
    AsnProp({ type: Time })
], TBSCertList.prototype, "thisUpdate", void 0);
__decorate([
    AsnProp({ type: Time, optional: true })
], TBSCertList.prototype, "nextUpdate", void 0);
__decorate([
    AsnProp({ type: RevokedCertificate, repeated: "sequence", optional: true })
], TBSCertList.prototype, "revokedCertificates", void 0);
__decorate([
    AsnProp({ type: Extension, optional: true, context: 0, repeated: "sequence" })
], TBSCertList.prototype, "crlExtensions", void 0);
