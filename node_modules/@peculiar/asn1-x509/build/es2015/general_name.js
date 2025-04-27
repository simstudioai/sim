import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes, AsnType, AsnTypeTypes, AsnOctetStringConverter, } from "@peculiar/asn1-schema";
import { IpConverter } from "./ip_converter";
import { DirectoryString, Name } from "./name";
export const AsnIpConverter = {
    fromASN: (value) => IpConverter.toString(AsnOctetStringConverter.fromASN(value)),
    toASN: (value) => AsnOctetStringConverter.toASN(IpConverter.fromString(value)),
};
export class OtherName {
    constructor(params = {}) {
        this.typeId = "";
        this.value = new ArrayBuffer(0);
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], OtherName.prototype, "typeId", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Any, context: 0 })
], OtherName.prototype, "value", void 0);
export class EDIPartyName {
    constructor(params = {}) {
        this.partyName = new DirectoryString();
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: DirectoryString, optional: true, context: 0, implicit: true })
], EDIPartyName.prototype, "nameAssigner", void 0);
__decorate([
    AsnProp({ type: DirectoryString, context: 1, implicit: true })
], EDIPartyName.prototype, "partyName", void 0);
let GeneralName = class GeneralName {
    constructor(params = {}) {
        Object.assign(this, params);
    }
};
__decorate([
    AsnProp({ type: OtherName, context: 0, implicit: true })
], GeneralName.prototype, "otherName", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.IA5String, context: 1, implicit: true })
], GeneralName.prototype, "rfc822Name", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.IA5String, context: 2, implicit: true })
], GeneralName.prototype, "dNSName", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Any, context: 3, implicit: true })
], GeneralName.prototype, "x400Address", void 0);
__decorate([
    AsnProp({ type: Name, context: 4, implicit: false })
], GeneralName.prototype, "directoryName", void 0);
__decorate([
    AsnProp({ type: EDIPartyName, context: 5 })
], GeneralName.prototype, "ediPartyName", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.IA5String, context: 6, implicit: true })
], GeneralName.prototype, "uniformResourceIdentifier", void 0);
__decorate([
    AsnProp({
        type: AsnPropTypes.OctetString,
        context: 7,
        implicit: true,
        converter: AsnIpConverter,
    })
], GeneralName.prototype, "iPAddress", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.ObjectIdentifier, context: 8, implicit: true })
], GeneralName.prototype, "registeredID", void 0);
GeneralName = __decorate([
    AsnType({ type: AsnTypeTypes.Choice })
], GeneralName);
export { GeneralName };
