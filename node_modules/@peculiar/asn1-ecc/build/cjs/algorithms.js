"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ecdsaWithSHA512 = exports.ecdsaWithSHA384 = exports.ecdsaWithSHA256 = exports.ecdsaWithSHA224 = exports.ecdsaWithSHA1 = void 0;
const asn1_x509_1 = require("@peculiar/asn1-x509");
const oid = require("./object_identifiers");
function create(algorithm) {
    return new asn1_x509_1.AlgorithmIdentifier({ algorithm });
}
exports.ecdsaWithSHA1 = create(oid.id_ecdsaWithSHA1);
exports.ecdsaWithSHA224 = create(oid.id_ecdsaWithSHA224);
exports.ecdsaWithSHA256 = create(oid.id_ecdsaWithSHA256);
exports.ecdsaWithSHA384 = create(oid.id_ecdsaWithSHA384);
exports.ecdsaWithSHA512 = create(oid.id_ecdsaWithSHA512);
