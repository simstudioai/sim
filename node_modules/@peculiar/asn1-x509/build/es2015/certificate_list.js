import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes } from "@peculiar/asn1-schema";
import { AlgorithmIdentifier } from "./algorithm_identifier";
import { TBSCertList } from "./tbs_cert_list";
export class CertificateList {
    constructor(params = {}) {
        this.tbsCertList = new TBSCertList();
        this.signatureAlgorithm = new AlgorithmIdentifier();
        this.signature = new ArrayBuffer(0);
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: TBSCertList })
], CertificateList.prototype, "tbsCertList", void 0);
__decorate([
    AsnProp({ type: AlgorithmIdentifier })
], CertificateList.prototype, "signatureAlgorithm", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.BitString })
], CertificateList.prototype, "signature", void 0);
