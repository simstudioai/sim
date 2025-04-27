import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes } from "@peculiar/asn1-schema";
import * as pvtsutils from "pvtsutils";
export class AlgorithmIdentifier {
    constructor(params = {}) {
        this.algorithm = "";
        Object.assign(this, params);
    }
    isEqual(data) {
        return (data instanceof AlgorithmIdentifier &&
            data.algorithm == this.algorithm &&
            ((data.parameters &&
                this.parameters &&
                pvtsutils.isEqual(data.parameters, this.parameters)) ||
                data.parameters === this.parameters));
    }
}
__decorate([
    AsnProp({
        type: AsnPropTypes.ObjectIdentifier,
    })
], AlgorithmIdentifier.prototype, "algorithm", void 0);
__decorate([
    AsnProp({
        type: AsnPropTypes.Any,
        optional: true,
    })
], AlgorithmIdentifier.prototype, "parameters", void 0);
