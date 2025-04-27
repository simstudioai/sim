import { AsnParser, OctetString } from '@peculiar/asn1-schema';
import { isoUint8Array } from './iso/index.js';
/**
 * Attestation Certificate Extension OID: `id-fido-gen-ce-aaguid`
 *
 * Sourced from https://fidoalliance.org/specs/fido-v2.0-ps-20150904/fido-key-attestation-v2.0-ps-20150904.html#verifying-an-attestation-statement
 */
const id_fido_gen_ce_aaguid = '1.3.6.1.4.1.45724.1.1.4';
/**
 * Look for the id-fido-gen-ce-aaguid certificate extension. If it's present then check it against
 * the attestation statement AAGUID.
 */
export function validateExtFIDOGenCEAAGUID(certExtensions, aaguid) {
    // The certificate had no extensions so there's nothing to validate
    if (!certExtensions) {
        return true;
    }
    const extFIDOGenCEAAGUID = certExtensions.find((ext) => ext.extnID === id_fido_gen_ce_aaguid);
    // The extension isn't present so there's nothing to validate
    if (!extFIDOGenCEAAGUID) {
        return true;
    }
    // Parse the extension value
    const parsedExtFIDOGenCEAAGUID = AsnParser.parse(extFIDOGenCEAAGUID.extnValue, OctetString);
    const extValue = new Uint8Array(parsedExtFIDOGenCEAAGUID.buffer);
    // Compare the two values
    const aaguidAndExtAreEqual = isoUint8Array.areEqual(aaguid, extValue);
    if (!aaguidAndExtAreEqual) {
        const _debugExtHex = isoUint8Array.toHex(extValue);
        const _debugAAGUIDHex = isoUint8Array.toHex(aaguid);
        throw new Error(`Certificate extension id-fido-gen-ce-aaguid (${id_fido_gen_ce_aaguid}) value of "${_debugExtHex}" was present but not equal to attestation statement AAGUID value of "${_debugAAGUIDHex}"`);
    }
    return true;
}
