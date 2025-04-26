import type { AttestationFormat } from '../helpers/decodeAttestationObject.js';
export type RootCertIdentifier = AttestationFormat | 'mds';
interface SettingsService {
    /**
     * Set potential root certificates for attestation formats that use them. Root certs will be tried
     * one-by-one when validating a certificate path.
     *
     * Certificates can be specified as a raw `Buffer`, or as a PEM-formatted string. If a
     * `Buffer` is passed in it will be converted to PEM format.
     */
    setRootCertificates(opts: {
        identifier: RootCertIdentifier;
        certificates: (Uint8Array | string)[];
    }): void;
    /**
     * Get any registered root certificates for the specified attestation format
     */
    getRootCertificates(opts: {
        identifier: RootCertIdentifier;
    }): string[];
}
/**
 * A basic service for specifying acceptable root certificates for all supported attestation
 * statement formats.
 *
 * In addition, default root certificates are included for the following statement formats:
 *
 * - `'android-key'`
 * - `'android-safetynet'`
 * - `'apple'`
 * - `'android-mds'`
 *
 * These can be overwritten as needed by setting alternative root certificates for their format
 * identifier using `setRootCertificates()`.
 */
export declare const SettingsService: SettingsService;
export {};
//# sourceMappingURL=settingsService.d.ts.map