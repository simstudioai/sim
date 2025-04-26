var CertificateIssuer_1;
import { __decorate } from "tslib";
import { AsnType, AsnTypeTypes } from "@peculiar/asn1-schema";
import { GeneralNames } from "../general_names";
import { id_ce } from "../object_identifiers";
export const id_ce_certificateIssuer = `${id_ce}.29`;
let CertificateIssuer = CertificateIssuer_1 = class CertificateIssuer extends GeneralNames {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, CertificateIssuer_1.prototype);
    }
};
CertificateIssuer = CertificateIssuer_1 = __decorate([
    AsnType({ type: AsnTypeTypes.Sequence })
], CertificateIssuer);
export { CertificateIssuer };
