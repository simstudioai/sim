"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha512_256WithRSAEncryption = exports.sha512_224WithRSAEncryption = exports.sha512WithRSAEncryption = exports.sha384WithRSAEncryption = exports.sha256WithRSAEncryption = exports.sha224WithRSAEncryption = exports.sha1WithRSAEncryption = exports.md5WithRSAEncryption = exports.md2WithRSAEncryption = exports.rsaEncryption = exports.pSpecifiedEmpty = exports.mgf1SHA1 = exports.sha512_256 = exports.sha512_224 = exports.sha512 = exports.sha384 = exports.sha256 = exports.sha224 = exports.sha1 = exports.md4 = exports.md2 = void 0;
const asn1_schema_1 = require("@peculiar/asn1-schema");
const asn1_x509_1 = require("@peculiar/asn1-x509");
const oid = require("./object_identifiers");
function create(algorithm) {
    return new asn1_x509_1.AlgorithmIdentifier({ algorithm, parameters: null });
}
exports.md2 = create(oid.id_md2);
exports.md4 = create(oid.id_md5);
exports.sha1 = create(oid.id_sha1);
exports.sha224 = create(oid.id_sha224);
exports.sha256 = create(oid.id_sha256);
exports.sha384 = create(oid.id_sha384);
exports.sha512 = create(oid.id_sha512);
exports.sha512_224 = create(oid.id_sha512_224);
exports.sha512_256 = create(oid.id_sha512_256);
exports.mgf1SHA1 = new asn1_x509_1.AlgorithmIdentifier({
    algorithm: oid.id_mgf1,
    parameters: asn1_schema_1.AsnConvert.serialize(exports.sha1),
});
exports.pSpecifiedEmpty = new asn1_x509_1.AlgorithmIdentifier({
    algorithm: oid.id_pSpecified,
    parameters: asn1_schema_1.AsnConvert.serialize(asn1_schema_1.AsnOctetStringConverter.toASN(new Uint8Array([
        0xda, 0x39, 0xa3, 0xee, 0x5e, 0x6b, 0x4b, 0x0d, 0x32, 0x55, 0xbf, 0xef, 0x95, 0x60, 0x18,
        0x90, 0xaf, 0xd8, 0x07, 0x09,
    ]).buffer)),
});
exports.rsaEncryption = create(oid.id_rsaEncryption);
exports.md2WithRSAEncryption = create(oid.id_md2WithRSAEncryption);
exports.md5WithRSAEncryption = create(oid.id_md5WithRSAEncryption);
exports.sha1WithRSAEncryption = create(oid.id_sha1WithRSAEncryption);
exports.sha224WithRSAEncryption = create(oid.id_sha512_224WithRSAEncryption);
exports.sha256WithRSAEncryption = create(oid.id_sha512_256WithRSAEncryption);
exports.sha384WithRSAEncryption = create(oid.id_sha384WithRSAEncryption);
exports.sha512WithRSAEncryption = create(oid.id_sha512WithRSAEncryption);
exports.sha512_224WithRSAEncryption = create(oid.id_sha512_224WithRSAEncryption);
exports.sha512_256WithRSAEncryption = create(oid.id_sha512_256WithRSAEncryption);
