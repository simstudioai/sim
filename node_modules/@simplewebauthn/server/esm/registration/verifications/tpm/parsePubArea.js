import { TPM_ALG, TPM_ECC_CURVE } from './constants.js';
import { isoUint8Array } from '../../../helpers/iso/index.js';
/**
 * Break apart a TPM attestation's pubArea buffer
 *
 * See 12.2.4 TPMT_PUBLIC here:
 * https://trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-2-Structures-00.96-130315.pdf
 */
export function parsePubArea(pubArea) {
    let pointer = 0;
    const dataView = isoUint8Array.toDataView(pubArea);
    const type = TPM_ALG[dataView.getUint16(pointer)];
    pointer += 2;
    const nameAlg = TPM_ALG[dataView.getUint16(pointer)];
    pointer += 2;
    // Get some authenticator attributes(?)
    // const objectAttributesInt = pubArea.slice(pointer, (pointer += 4)).readUInt32BE(0);
    const objectAttributesInt = dataView.getUint32(pointer);
    pointer += 4;
    const objectAttributes = {
        fixedTPM: !!(objectAttributesInt & 1),
        stClear: !!(objectAttributesInt & 2),
        fixedParent: !!(objectAttributesInt & 8),
        sensitiveDataOrigin: !!(objectAttributesInt & 16),
        userWithAuth: !!(objectAttributesInt & 32),
        adminWithPolicy: !!(objectAttributesInt & 64),
        noDA: !!(objectAttributesInt & 512),
        encryptedDuplication: !!(objectAttributesInt & 1024),
        restricted: !!(objectAttributesInt & 32768),
        decrypt: !!(objectAttributesInt & 65536),
        signOrEncrypt: !!(objectAttributesInt & 131072),
    };
    // Slice out the authPolicy of dynamic length
    const authPolicyLength = dataView.getUint16(pointer);
    pointer += 2;
    const authPolicy = pubArea.slice(pointer, pointer += authPolicyLength);
    // Extract additional curve params according to type
    const parameters = {};
    let unique = Uint8Array.from([]);
    if (type === 'TPM_ALG_RSA') {
        const symmetric = TPM_ALG[dataView.getUint16(pointer)];
        pointer += 2;
        const scheme = TPM_ALG[dataView.getUint16(pointer)];
        pointer += 2;
        const keyBits = dataView.getUint16(pointer);
        pointer += 2;
        const exponent = dataView.getUint32(pointer);
        pointer += 4;
        parameters.rsa = { symmetric, scheme, keyBits, exponent };
        /**
         * See 11.2.4.5 TPM2B_PUBLIC_KEY_RSA here:
         * https://trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-2-Structures-00.96-130315.pdf
         */
        // const uniqueLength = pubArea.slice(pointer, (pointer += 2)).readUInt16BE(0);
        const uniqueLength = dataView.getUint16(pointer);
        pointer += 2;
        unique = pubArea.slice(pointer, pointer += uniqueLength);
    }
    else if (type === 'TPM_ALG_ECC') {
        const symmetric = TPM_ALG[dataView.getUint16(pointer)];
        pointer += 2;
        const scheme = TPM_ALG[dataView.getUint16(pointer)];
        pointer += 2;
        const curveID = TPM_ECC_CURVE[dataView.getUint16(pointer)];
        pointer += 2;
        const kdf = TPM_ALG[dataView.getUint16(pointer)];
        pointer += 2;
        parameters.ecc = { symmetric, scheme, curveID, kdf };
        /**
         * See 11.2.5.1 TPM2B_ECC_PARAMETER here:
         * https://trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-2-Structures-00.96-130315.pdf
         */
        // Retrieve X
        const uniqueXLength = dataView.getUint16(pointer);
        pointer += 2;
        const uniqueX = pubArea.slice(pointer, pointer += uniqueXLength);
        // Retrieve Y
        const uniqueYLength = dataView.getUint16(pointer);
        pointer += 2;
        const uniqueY = pubArea.slice(pointer, pointer += uniqueYLength);
        unique = isoUint8Array.concat([uniqueX, uniqueY]);
    }
    else {
        throw new Error(`Unexpected type "${type}" (TPM)`);
    }
    return {
        type,
        nameAlg,
        objectAttributes,
        authPolicy,
        parameters,
        unique,
    };
}
