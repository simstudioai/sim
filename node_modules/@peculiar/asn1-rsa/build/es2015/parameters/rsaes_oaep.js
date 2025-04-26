import { __decorate } from "tslib";
import { AsnProp, AsnConvert } from "@peculiar/asn1-schema";
import { AlgorithmIdentifier } from "@peculiar/asn1-x509";
import { id_mgf1, id_RSAES_OAEP } from "../object_identifiers";
import { sha1, mgf1SHA1, pSpecifiedEmpty } from "../algorithms";
export class RsaEsOaepParams {
    constructor(params = {}) {
        this.hashAlgorithm = new AlgorithmIdentifier(sha1);
        this.maskGenAlgorithm = new AlgorithmIdentifier({
            algorithm: id_mgf1,
            parameters: AsnConvert.serialize(sha1),
        });
        this.pSourceAlgorithm = new AlgorithmIdentifier(pSpecifiedEmpty);
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: AlgorithmIdentifier, context: 0, defaultValue: sha1 })
], RsaEsOaepParams.prototype, "hashAlgorithm", void 0);
__decorate([
    AsnProp({ type: AlgorithmIdentifier, context: 1, defaultValue: mgf1SHA1 })
], RsaEsOaepParams.prototype, "maskGenAlgorithm", void 0);
__decorate([
    AsnProp({ type: AlgorithmIdentifier, context: 2, defaultValue: pSpecifiedEmpty })
], RsaEsOaepParams.prototype, "pSourceAlgorithm", void 0);
export const RSAES_OAEP = new AlgorithmIdentifier({
    algorithm: id_RSAES_OAEP,
    parameters: AsnConvert.serialize(new RsaEsOaepParams()),
});
