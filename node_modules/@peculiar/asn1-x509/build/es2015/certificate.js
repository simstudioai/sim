import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes } from "@peculiar/asn1-schema";
import { AlgorithmIdentifier } from "./algorithm_identifier";
import { TBSCertificate } from "./tbs_certificate";
export class Certificate {
    constructor(params = {}) {
        this.tbsCertificate = new TBSCertificate();
        this.signatureAlgorithm = new AlgorithmIdentifier();
        this.signatureValue = new ArrayBuffer(0);
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: TBSCertificate })
], Certificate.prototype, "tbsCertificate", void 0);
__decorate([
    AsnProp({ type: AlgorithmIdentifier })
], Certificate.prototype, "signatureAlgorithm", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.BitString })
], Certificate.prototype, "signatureValue", void 0);
