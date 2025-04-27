import { __decorate } from "tslib";
import { AsnType, AsnTypeTypes } from "@peculiar/asn1-schema";
import { id_ce } from "../object_identifiers";
import { CRLNumber } from "./crl_number";
export const id_ce_deltaCRLIndicator = `${id_ce}.27`;
let BaseCRLNumber = class BaseCRLNumber extends CRLNumber {
};
BaseCRLNumber = __decorate([
    AsnType({ type: AsnTypeTypes.Choice })
], BaseCRLNumber);
export { BaseCRLNumber };
