import { COSEALG } from './cose.js';
/**
 * Map X.509 signature algorithm OIDs to COSE algorithm IDs
 *
 * - EC2 OIDs: https://oidref.com/1.2.840.10045.4.3
 * - RSA OIDs: https://oidref.com/1.2.840.113549.1.1
 */
export function mapX509SignatureAlgToCOSEAlg(signatureAlgorithm) {
    let alg;
    if (signatureAlgorithm === '1.2.840.10045.4.3.2') {
        alg = COSEALG.ES256;
    }
    else if (signatureAlgorithm === '1.2.840.10045.4.3.3') {
        alg = COSEALG.ES384;
    }
    else if (signatureAlgorithm === '1.2.840.10045.4.3.4') {
        alg = COSEALG.ES512;
    }
    else if (signatureAlgorithm === '1.2.840.113549.1.1.11') {
        alg = COSEALG.RS256;
    }
    else if (signatureAlgorithm === '1.2.840.113549.1.1.12') {
        alg = COSEALG.RS384;
    }
    else if (signatureAlgorithm === '1.2.840.113549.1.1.13') {
        alg = COSEALG.RS512;
    }
    else if (signatureAlgorithm === '1.2.840.113549.1.1.5') {
        alg = COSEALG.RS1;
    }
    else {
        throw new Error(`Unable to map X.509 signature algorithm ${signatureAlgorithm} to a COSE algorithm`);
    }
    return alg;
}
