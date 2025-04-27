var AuthorityInfoAccessSyntax_1;
import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes, AsnArray, AsnType, AsnTypeTypes } from "@peculiar/asn1-schema";
import { GeneralName } from "../general_name";
import { id_pe } from "../object_identifiers";
export const id_pe_authorityInfoAccess = `${id_pe}.1`;
export class AccessDescription {
    constructor(params = {}) {
        this.accessMethod = "";
        this.accessLocation = new GeneralName();
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], AccessDescription.prototype, "accessMethod", void 0);
__decorate([
    AsnProp({ type: GeneralName })
], AccessDescription.prototype, "accessLocation", void 0);
let AuthorityInfoAccessSyntax = AuthorityInfoAccessSyntax_1 = class AuthorityInfoAccessSyntax extends AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, AuthorityInfoAccessSyntax_1.prototype);
    }
};
AuthorityInfoAccessSyntax = AuthorityInfoAccessSyntax_1 = __decorate([
    AsnType({ type: AsnTypeTypes.Sequence, itemType: AccessDescription })
], AuthorityInfoAccessSyntax);
export { AuthorityInfoAccessSyntax };
