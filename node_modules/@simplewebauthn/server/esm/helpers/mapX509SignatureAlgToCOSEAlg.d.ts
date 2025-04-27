import { COSEALG } from './cose.js';
/**
 * Map X.509 signature algorithm OIDs to COSE algorithm IDs
 *
 * - EC2 OIDs: https://oidref.com/1.2.840.10045.4.3
 * - RSA OIDs: https://oidref.com/1.2.840.113549.1.1
 */
export declare function mapX509SignatureAlgToCOSEAlg(signatureAlgorithm: string): COSEALG;
//# sourceMappingURL=mapX509SignatureAlgToCOSEAlg.d.ts.map