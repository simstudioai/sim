"use strict";
// deno-lint-ignore-file no-dupe-keys
/**
 * A whole lotta domain knowledge is captured here, with hazy connections to source
 * documents. Good places to start searching for more info on these values are the
 * following Trusted Computing Group TPM Library docs linked in the WebAuthn API:
 *
 * - https://www.trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-1-Architecture-01.38.pdf
 * - https://www.trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-2-Structures-01.38.pdf
 * - https://www.trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-3-Commands-01.38.pdf
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TPM_ECC_CURVE_COSE_CRV_MAP = exports.TPM_MANUFACTURERS = exports.TPM_ECC_CURVE = exports.TPM_ALG = exports.TPM_ST = void 0;
/**
 * 6.9 TPM_ST (Structure Tags)
 */
exports.TPM_ST = {
    0x00c4: 'TPM_ST_RSP_COMMAND',
    0x8000: 'TPM_ST_NULL',
    0x8001: 'TPM_ST_NO_SESSIONS',
    0x8002: 'TPM_ST_SESSIONS',
    0x8014: 'TPM_ST_ATTEST_NV',
    0x8015: 'TPM_ST_ATTEST_COMMAND_AUDIT',
    0x8016: 'TPM_ST_ATTEST_SESSION_AUDIT',
    0x8017: 'TPM_ST_ATTEST_CERTIFY',
    0x8018: 'TPM_ST_ATTEST_QUOTE',
    0x8019: 'TPM_ST_ATTEST_TIME',
    0x801a: 'TPM_ST_ATTEST_CREATION',
    0x8021: 'TPM_ST_CREATION',
    0x8022: 'TPM_ST_VERIFIED',
    0x8023: 'TPM_ST_AUTH_SECRET',
    0x8024: 'TPM_ST_HASHCHECK',
    0x8025: 'TPM_ST_AUTH_SIGNED',
    0x8029: 'TPM_ST_FU_MANIFEST',
};
/**
 * 6.3 TPM_ALG_ID
 */
exports.TPM_ALG = {
    0x0000: 'TPM_ALG_ERROR',
    0x0001: 'TPM_ALG_RSA',
    0x0004: 'TPM_ALG_SHA',
    // @ts-ignore 2300
    0x0004: 'TPM_ALG_SHA1',
    0x0005: 'TPM_ALG_HMAC',
    0x0006: 'TPM_ALG_AES',
    0x0007: 'TPM_ALG_MGF1',
    0x0008: 'TPM_ALG_KEYEDHASH',
    0x000a: 'TPM_ALG_XOR',
    0x000b: 'TPM_ALG_SHA256',
    0x000c: 'TPM_ALG_SHA384',
    0x000d: 'TPM_ALG_SHA512',
    0x0010: 'TPM_ALG_NULL',
    0x0012: 'TPM_ALG_SM3_256',
    0x0013: 'TPM_ALG_SM4',
    0x0014: 'TPM_ALG_RSASSA',
    0x0015: 'TPM_ALG_RSAES',
    0x0016: 'TPM_ALG_RSAPSS',
    0x0017: 'TPM_ALG_OAEP',
    0x0018: 'TPM_ALG_ECDSA',
    0x0019: 'TPM_ALG_ECDH',
    0x001a: 'TPM_ALG_ECDAA',
    0x001b: 'TPM_ALG_SM2',
    0x001c: 'TPM_ALG_ECSCHNORR',
    0x001d: 'TPM_ALG_ECMQV',
    0x0020: 'TPM_ALG_KDF1_SP800_56A',
    0x0021: 'TPM_ALG_KDF2',
    0x0022: 'TPM_ALG_KDF1_SP800_108',
    0x0023: 'TPM_ALG_ECC',
    0x0025: 'TPM_ALG_SYMCIPHER',
    0x0026: 'TPM_ALG_CAMELLIA',
    0x0040: 'TPM_ALG_CTR',
    0x0041: 'TPM_ALG_OFB',
    0x0042: 'TPM_ALG_CBC',
    0x0043: 'TPM_ALG_CFB',
    0x0044: 'TPM_ALG_ECB',
};
/**
 * 6.4 TPM_ECC_CURVE
 */
exports.TPM_ECC_CURVE = {
    0x0000: 'TPM_ECC_NONE',
    0x0001: 'TPM_ECC_NIST_P192',
    0x0002: 'TPM_ECC_NIST_P224',
    0x0003: 'TPM_ECC_NIST_P256',
    0x0004: 'TPM_ECC_NIST_P384',
    0x0005: 'TPM_ECC_NIST_P521',
    0x0010: 'TPM_ECC_BN_P256',
    0x0011: 'TPM_ECC_BN_P638',
    0x0020: 'TPM_ECC_SM2_P256',
};
/**
 * Sourced from https://trustedcomputinggroup.org/resource/vendor-id-registry/
 *
 * Latest version:
 * https://trustedcomputinggroup.org/wp-content/uploads/TCG-TPM-Vendor-ID-Registry-Version-1.02-Revision-1.00.pdf
 */
exports.TPM_MANUFACTURERS = {
    'id:414D4400': { name: 'AMD', id: 'AMD' },
    'id:414E5400': { name: 'Ant Group', id: 'ANT' },
    'id:41544D4C': { name: 'Atmel', id: 'ATML' },
    'id:4252434D': { name: 'Broadcom', id: 'BRCM' },
    'id:4353434F': { name: 'Cisco', id: 'CSCO' },
    'id:464C5953': { name: 'Flyslice Technologies', id: 'FLYS' },
    'id:524F4343': { name: 'Fuzhou Rockchip', id: 'ROCC' },
    'id:474F4F47': { name: 'Google', id: 'GOOG' },
    'id:48504900': { name: 'HPI', id: 'HPI' },
    'id:48504500': { name: 'HPE', id: 'HPE' },
    'id:48495349': { name: 'Huawei', id: 'HISI' },
    'id:49424d00': { name: 'IBM', id: 'IBM' },
    'id:49424D00': { name: 'IBM', id: 'IBM' }, // Same ID for IBM as above, except the "D" is capitalized as per TPM spec
    'id:49465800': { name: 'Infineon', id: 'IFX' },
    'id:494E5443': { name: 'Intel', id: 'INTC' },
    'id:4C454E00': { name: 'Lenovo', id: 'LEN' },
    'id:4D534654': { name: 'Microsoft', id: 'MSFT' },
    'id:4E534D20': { name: 'National Semiconductor', id: 'NSM' },
    'id:4E545A00': { name: 'Nationz', id: 'NTZ' },
    'id:4E534700': { name: 'NSING', id: 'NSG' },
    'id:4E544300': { name: 'Nuvoton Technology', id: 'NTC' },
    'id:51434F4D': { name: 'Qualcomm', id: 'QCOM' },
    'id:534D534E': { name: 'Samsung', id: 'SMSN' },
    'id:53454345': { name: 'SecEdge', id: 'SECE' },
    'id:534E5300': { name: 'Sinosun', id: 'SNS' },
    'id:534D5343': { name: 'SMSC', id: 'SMSC' },
    'id:53544D20': { name: 'STMicroelectronics', id: 'STM' },
    'id:54584E00': { name: 'Texas Instruments', id: 'TXN' },
    'id:57454300': { name: 'Winbond', id: 'WEC' },
    'id:5345414C': { name: 'Wisekey', id: 'SEAL' },
    'id:FFFFF1D0': { name: 'FIDO Alliance', id: 'FIDO' }, // FIDO Conformance
};
/**
 * Match TPM public area curve ID's to `crv` numbers used in COSE public keys
 */
exports.TPM_ECC_CURVE_COSE_CRV_MAP = {
    TPM_ECC_NIST_P256: 1, // p256
    TPM_ECC_NIST_P384: 2, // p384
    TPM_ECC_NIST_P521: 3, // p521
    TPM_ECC_BN_P256: 1, // p256
    TPM_ECC_SM2_P256: 1, // p256
};
