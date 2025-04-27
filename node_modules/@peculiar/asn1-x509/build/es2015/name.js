var RelativeDistinguishedName_1, RDNSequence_1, Name_1;
import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes, AsnType, AsnTypeTypes, AsnArray } from "@peculiar/asn1-schema";
import { Convert } from "pvtsutils";
let DirectoryString = class DirectoryString {
    constructor(params = {}) {
        Object.assign(this, params);
    }
    toString() {
        return (this.bmpString ||
            this.printableString ||
            this.teletexString ||
            this.universalString ||
            this.utf8String ||
            "");
    }
};
__decorate([
    AsnProp({ type: AsnPropTypes.TeletexString })
], DirectoryString.prototype, "teletexString", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.PrintableString })
], DirectoryString.prototype, "printableString", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.UniversalString })
], DirectoryString.prototype, "universalString", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Utf8String })
], DirectoryString.prototype, "utf8String", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.BmpString })
], DirectoryString.prototype, "bmpString", void 0);
DirectoryString = __decorate([
    AsnType({ type: AsnTypeTypes.Choice })
], DirectoryString);
export { DirectoryString };
let AttributeValue = class AttributeValue extends DirectoryString {
    constructor(params = {}) {
        super(params);
        Object.assign(this, params);
    }
    toString() {
        return this.ia5String || (this.anyValue ? Convert.ToHex(this.anyValue) : super.toString());
    }
};
__decorate([
    AsnProp({ type: AsnPropTypes.IA5String })
], AttributeValue.prototype, "ia5String", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Any })
], AttributeValue.prototype, "anyValue", void 0);
AttributeValue = __decorate([
    AsnType({ type: AsnTypeTypes.Choice })
], AttributeValue);
export { AttributeValue };
export class AttributeTypeAndValue {
    constructor(params = {}) {
        this.type = "";
        this.value = new AttributeValue();
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], AttributeTypeAndValue.prototype, "type", void 0);
__decorate([
    AsnProp({ type: AttributeValue })
], AttributeTypeAndValue.prototype, "value", void 0);
let RelativeDistinguishedName = RelativeDistinguishedName_1 = class RelativeDistinguishedName extends AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, RelativeDistinguishedName_1.prototype);
    }
};
RelativeDistinguishedName = RelativeDistinguishedName_1 = __decorate([
    AsnType({ type: AsnTypeTypes.Set, itemType: AttributeTypeAndValue })
], RelativeDistinguishedName);
export { RelativeDistinguishedName };
let RDNSequence = RDNSequence_1 = class RDNSequence extends AsnArray {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, RDNSequence_1.prototype);
    }
};
RDNSequence = RDNSequence_1 = __decorate([
    AsnType({ type: AsnTypeTypes.Sequence, itemType: RelativeDistinguishedName })
], RDNSequence);
export { RDNSequence };
let Name = Name_1 = class Name extends RDNSequence {
    constructor(items) {
        super(items);
        Object.setPrototypeOf(this, Name_1.prototype);
    }
};
Name = Name_1 = __decorate([
    AsnType({ type: AsnTypeTypes.Sequence })
], Name);
export { Name };
