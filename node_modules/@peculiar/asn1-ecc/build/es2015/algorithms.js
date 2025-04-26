import { AlgorithmIdentifier } from "@peculiar/asn1-x509";
import * as oid from "./object_identifiers";
function create(algorithm) {
    return new AlgorithmIdentifier({ algorithm });
}
export const ecdsaWithSHA1 = create(oid.id_ecdsaWithSHA1);
export const ecdsaWithSHA224 = create(oid.id_ecdsaWithSHA224);
export const ecdsaWithSHA256 = create(oid.id_ecdsaWithSHA256);
export const ecdsaWithSHA384 = create(oid.id_ecdsaWithSHA384);
export const ecdsaWithSHA512 = create(oid.id_ecdsaWithSHA512);
