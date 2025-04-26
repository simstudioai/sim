import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes, AsnIntegerArrayBufferConverter, OctetString, } from "@peculiar/asn1-schema";
import { GeneralName } from "../general_name";
import { id_ce } from "../object_identifiers";
export const id_ce_authorityKeyIdentifier = `${id_ce}.35`;
export class KeyIdentifier extends OctetString {
}
export class AuthorityKeyIdentifier {
    constructor(params = {}) {
        if (params) {
            Object.assign(this, params);
        }
    }
}
__decorate([
    AsnProp({ type: KeyIdentifier, context: 0, optional: true, implicit: true })
], AuthorityKeyIdentifier.prototype, "keyIdentifier", void 0);
__decorate([
    AsnProp({ type: GeneralName, context: 1, optional: true, implicit: true, repeated: "sequence" })
], AuthorityKeyIdentifier.prototype, "authorityCertIssuer", void 0);
__decorate([
    AsnProp({
        type: AsnPropTypes.Integer,
        context: 2,
        optional: true,
        implicit: true,
        converter: AsnIntegerArrayBufferConverter,
    })
], AuthorityKeyIdentifier.prototype, "authorityCertSerialNumber", void 0);
