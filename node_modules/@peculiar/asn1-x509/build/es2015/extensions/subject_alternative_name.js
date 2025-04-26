var SubjectAlternativeName_1;
import { __decorate } from "tslib";
import { AsnType, AsnTypeTypes } from "@peculiar/asn1-schema";
import { GeneralNames } from "../general_names";
import { id_ce } from "../object_identifiers";
export const id_ce_subjectAltName = `${id_ce}.17`;
let SubjectAlternativeName = SubjectAlternativeName_1 = class SubjectAlternativeName extends GeneralNames {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, SubjectAlternativeName_1.prototype);
    }
};
SubjectAlternativeName = SubjectAlternativeName_1 = __decorate([
    AsnType({ type: AsnTypeTypes.Sequence })
], SubjectAlternativeName);
export { SubjectAlternativeName };
