import { convertCertBufferToPEM } from '../helpers/convertCertBufferToPEM.js';
import { GlobalSign_Root_CA } from './defaultRootCerts/android-safetynet.js';
import { Google_Hardware_Attestation_Root_1, Google_Hardware_Attestation_Root_2, Google_Hardware_Attestation_Root_3, Google_Hardware_Attestation_Root_4, } from './defaultRootCerts/android-key.js';
import { Apple_WebAuthn_Root_CA } from './defaultRootCerts/apple.js';
import { GlobalSign_Root_CA_R3 } from './defaultRootCerts/mds.js';
class BaseSettingsService {
    constructor() {
        // Certificates are stored as PEM-formatted strings
        Object.defineProperty(this, "pemCertificates", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.pemCertificates = new Map();
    }
    setRootCertificates(opts) {
        const { identifier, certificates } = opts;
        const newCertificates = [];
        for (const cert of certificates) {
            if (cert instanceof Uint8Array) {
                newCertificates.push(convertCertBufferToPEM(cert));
            }
            else {
                newCertificates.push(cert);
            }
        }
        this.pemCertificates.set(identifier, newCertificates);
    }
    getRootCertificates(opts) {
        const { identifier } = opts;
        return this.pemCertificates.get(identifier) ?? [];
    }
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
export const SettingsService = new BaseSettingsService();
// Initialize default certificates
SettingsService.setRootCertificates({
    identifier: 'android-key',
    certificates: [
        Google_Hardware_Attestation_Root_1,
        Google_Hardware_Attestation_Root_2,
        Google_Hardware_Attestation_Root_3,
        Google_Hardware_Attestation_Root_4,
    ],
});
SettingsService.setRootCertificates({
    identifier: 'android-safetynet',
    certificates: [GlobalSign_Root_CA],
});
SettingsService.setRootCertificates({
    identifier: 'apple',
    certificates: [Apple_WebAuthn_Root_CA],
});
SettingsService.setRootCertificates({
    identifier: 'mds',
    certificates: [GlobalSign_Root_CA_R3],
});
