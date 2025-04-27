var SubjectInfoAccessSyntax_1;
import { __decorate } from "tslib";
import { AsnArray, AsnType, AsnTypeTypes } from "@peculiar/asn1-schema";
import { id_pe } from "../object_identifiers";
import { AccessDescription } from "./authority_information_access";
export const id_pe_subjectInfoAccess = `${id_pe}.11`;
let SubjectInfoAccessSyntax = SubjectInfoAccessSyntax_1 = class SubjectInfoAccessSyntax extends AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, SubjectInfoAccessSyntax_1.prototype);
    }
};
SubjectInfoAccessSyntax = SubjectInfoAccessSyntax_1 = __decorate([
    AsnType({ type: AsnTypeTypes.Sequence, itemType: AccessDescription })
], SubjectInfoAccessSyntax);
export { SubjectInfoAccessSyntax };
