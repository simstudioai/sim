var IssueAlternativeName_1;
import { __decorate } from "tslib";
import { AsnType, AsnTypeTypes } from "@peculiar/asn1-schema";
import { GeneralNames } from "../general_names";
import { id_ce } from "../object_identifiers";
export const id_ce_issuerAltName = `${id_ce}.18`;
let IssueAlternativeName = IssueAlternativeName_1 = class IssueAlternativeName extends GeneralNames {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, IssueAlternativeName_1.prototype);
    }
};
IssueAlternativeName = IssueAlternativeName_1 = __decorate([
    AsnType({ type: AsnTypeTypes.Sequence })
], IssueAlternativeName);
export { IssueAlternativeName };
