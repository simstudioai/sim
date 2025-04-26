var CertificatePolicies_1;
import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes, AsnType, AsnTypeTypes, AsnArray } from "@peculiar/asn1-schema";
import { id_ce } from "../object_identifiers";
export const id_ce_certificatePolicies = `${id_ce}.32`;
export const id_ce_certificatePolicies_anyPolicy = `${id_ce_certificatePolicies}.0`;
let DisplayText = class DisplayText {
    constructor(params = {}) {
        Object.assign(this, params);
    }
    toString() {
        return this.ia5String || this.visibleString || this.bmpString || this.utf8String || "";
    }
};
__decorate([
    AsnProp({ type: AsnPropTypes.IA5String })
], DisplayText.prototype, "ia5String", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.VisibleString })
], DisplayText.prototype, "visibleString", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.BmpString })
], DisplayText.prototype, "bmpString", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Utf8String })
], DisplayText.prototype, "utf8String", void 0);
DisplayText = __decorate([
    AsnType({ type: AsnTypeTypes.Choice })
], DisplayText);
export { DisplayText };
export class NoticeReference {
    constructor(params = {}) {
        this.organization = new DisplayText();
        this.noticeNumbers = [];
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: DisplayText })
], NoticeReference.prototype, "organization", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Integer, repeated: "sequence" })
], NoticeReference.prototype, "noticeNumbers", void 0);
export class UserNotice {
    constructor(params = {}) {
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: NoticeReference, optional: true })
], UserNotice.prototype, "noticeRef", void 0);
__decorate([
    AsnProp({ type: DisplayText, optional: true })
], UserNotice.prototype, "explicitText", void 0);
let Qualifier = class Qualifier {
    constructor(params = {}) {
        Object.assign(this, params);
    }
};
__decorate([
    AsnProp({ type: AsnPropTypes.IA5String })
], Qualifier.prototype, "cPSuri", void 0);
__decorate([
    AsnProp({ type: UserNotice })
], Qualifier.prototype, "userNotice", void 0);
Qualifier = __decorate([
    AsnType({ type: AsnTypeTypes.Choice })
], Qualifier);
export { Qualifier };
export class PolicyQualifierInfo {
    constructor(params = {}) {
        this.policyQualifierId = "";
        this.qualifier = new ArrayBuffer(0);
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], PolicyQualifierInfo.prototype, "policyQualifierId", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Any })
], PolicyQualifierInfo.prototype, "qualifier", void 0);
export class PolicyInformation {
    constructor(params = {}) {
        this.policyIdentifier = "";
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], PolicyInformation.prototype, "policyIdentifier", void 0);
__decorate([
    AsnProp({ type: PolicyQualifierInfo, repeated: "sequence", optional: true })
], PolicyInformation.prototype, "policyQualifiers", void 0);
let CertificatePolicies = CertificatePolicies_1 = class CertificatePolicies extends AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, CertificatePolicies_1.prototype);
    }
};
CertificatePolicies = CertificatePolicies_1 = __decorate([
    AsnType({ type: AsnTypeTypes.Sequence, itemType: PolicyInformation })
], CertificatePolicies);
export { CertificatePolicies };
