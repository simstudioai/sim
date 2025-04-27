import { AsnConvert, AsnOctetStringConverter } from "@peculiar/asn1-schema";
import { AlgorithmIdentifier } from "@peculiar/asn1-x509";
import * as oid from "./object_identifiers";
function create(algorithm) {
    return new AlgorithmIdentifier({ algorithm, parameters: null });
}
export const md2 = create(oid.id_md2);
export const md4 = create(oid.id_md5);
export const sha1 = create(oid.id_sha1);
export const sha224 = create(oid.id_sha224);
export const sha256 = create(oid.id_sha256);
export const sha384 = create(oid.id_sha384);
export const sha512 = create(oid.id_sha512);
export const sha512_224 = create(oid.id_sha512_224);
export const sha512_256 = create(oid.id_sha512_256);
export const mgf1SHA1 = new AlgorithmIdentifier({
    algorithm: oid.id_mgf1,
    parameters: AsnConvert.serialize(sha1),
});
export const pSpecifiedEmpty = new AlgorithmIdentifier({
    algorithm: oid.id_pSpecified,
    parameters: AsnConvert.serialize(AsnOctetStringConverter.toASN(new Uint8Array([
        0xda, 0x39, 0xa3, 0xee, 0x5e, 0x6b, 0x4b, 0x0d, 0x32, 0x55, 0xbf, 0xef, 0x95, 0x60, 0x18,
        0x90, 0xaf, 0xd8, 0x07, 0x09,
    ]).buffer)),
});
export const rsaEncryption = create(oid.id_rsaEncryption);
export const md2WithRSAEncryption = create(oid.id_md2WithRSAEncryption);
export const md5WithRSAEncryption = create(oid.id_md5WithRSAEncryption);
export const sha1WithRSAEncryption = create(oid.id_sha1WithRSAEncryption);
export const sha224WithRSAEncryption = create(oid.id_sha512_224WithRSAEncryption);
export const sha256WithRSAEncryption = create(oid.id_sha512_256WithRSAEncryption);
export const sha384WithRSAEncryption = create(oid.id_sha384WithRSAEncryption);
export const sha512WithRSAEncryption = create(oid.id_sha512WithRSAEncryption);
export const sha512_224WithRSAEncryption = create(oid.id_sha512_224WithRSAEncryption);
export const sha512_256WithRSAEncryption = create(oid.id_sha512_256WithRSAEncryption);
