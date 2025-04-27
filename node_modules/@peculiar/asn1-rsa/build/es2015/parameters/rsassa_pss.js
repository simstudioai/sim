import { __decorate } from "tslib";
import { AsnProp, AsnConvert, AsnPropTypes } from "@peculiar/asn1-schema";
import { AlgorithmIdentifier } from "@peculiar/asn1-x509";
import { id_mgf1, id_RSASSA_PSS } from "../object_identifiers";
import { sha1, mgf1SHA1 } from "../algorithms";
export class RsaSaPssParams {
    constructor(params = {}) {
        this.hashAlgorithm = new AlgorithmIdentifier(sha1);
        this.maskGenAlgorithm = new AlgorithmIdentifier({
            algorithm: id_mgf1,
            parameters: AsnConvert.serialize(sha1),
        });
        this.saltLength = 20;
        this.trailerField = 1;
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: AlgorithmIdentifier, context: 0, defaultValue: sha1 })
], RsaSaPssParams.prototype, "hashAlgorithm", void 0);
__decorate([
    AsnProp({ type: AlgorithmIdentifier, context: 1, defaultValue: mgf1SHA1 })
], RsaSaPssParams.prototype, "maskGenAlgorithm", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Integer, context: 2, defaultValue: 20 })
], RsaSaPssParams.prototype, "saltLength", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Integer, context: 3, defaultValue: 1 })
], RsaSaPssParams.prototype, "trailerField", void 0);
export const RSASSA_PSS = new AlgorithmIdentifier({
    algorithm: id_RSASSA_PSS,
    parameters: AsnConvert.serialize(new RsaSaPssParams()),
});
