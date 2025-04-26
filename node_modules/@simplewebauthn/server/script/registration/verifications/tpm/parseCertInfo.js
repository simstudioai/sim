"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCertInfo = parseCertInfo;
const constants_js_1 = require("./constants.js");
const index_js_1 = require("../../../helpers/iso/index.js");
/**
 * Cut up a TPM attestation's certInfo into intelligible chunks
 */
function parseCertInfo(certInfo) {
    let pointer = 0;
    const dataView = index_js_1.isoUint8Array.toDataView(certInfo);
    // Get a magic constant
    const magic = dataView.getUint32(pointer);
    pointer += 4;
    // Determine the algorithm used for attestation
    const typeBuffer = dataView.getUint16(pointer);
    pointer += 2;
    const type = constants_js_1.TPM_ST[typeBuffer];
    // The name of a parent entity, can be ignored
    const qualifiedSignerLength = dataView.getUint16(pointer);
    pointer += 2;
    const qualifiedSigner = certInfo.slice(pointer, pointer += qualifiedSignerLength);
    // Get the expected hash of `attsToBeSigned`
    const extraDataLength = dataView.getUint16(pointer);
    pointer += 2;
    const extraData = certInfo.slice(pointer, pointer += extraDataLength);
    // Information about the TPM device's internal clock, can be ignored
    const clock = certInfo.slice(pointer, pointer += 8);
    const resetCount = dataView.getUint32(pointer);
    pointer += 4;
    const restartCount = dataView.getUint32(pointer);
    pointer += 4;
    const safe = !!certInfo.slice(pointer, pointer += 1);
    const clockInfo = { clock, resetCount, restartCount, safe };
    // TPM device firmware version
    const firmwareVersion = certInfo.slice(pointer, pointer += 8);
    // Attested Name
    const attestedNameLength = dataView.getUint16(pointer);
    pointer += 2;
    const attestedName = certInfo.slice(pointer, pointer += attestedNameLength);
    const attestedNameDataView = index_js_1.isoUint8Array.toDataView(attestedName);
    // Attested qualified name, can be ignored
    const qualifiedNameLength = dataView.getUint16(pointer);
    pointer += 2;
    const qualifiedName = certInfo.slice(pointer, pointer += qualifiedNameLength);
    const attested = {
        nameAlg: constants_js_1.TPM_ALG[attestedNameDataView.getUint16(0)],
        nameAlgBuffer: attestedName.slice(0, 2),
        name: attestedName,
        qualifiedName,
    };
    return {
        magic,
        type,
        qualifiedSigner,
        extraData,
        clockInfo,
        firmwareVersion,
        attested,
    };
}
