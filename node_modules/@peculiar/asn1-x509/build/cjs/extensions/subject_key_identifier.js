"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubjectKeyIdentifier = exports.id_ce_subjectKeyIdentifier = void 0;
const object_identifiers_1 = require("../object_identifiers");
const authority_key_identifier_1 = require("./authority_key_identifier");
exports.id_ce_subjectKeyIdentifier = `${object_identifiers_1.id_ce}.14`;
class SubjectKeyIdentifier extends authority_key_identifier_1.KeyIdentifier {
}
exports.SubjectKeyIdentifier = SubjectKeyIdentifier;
