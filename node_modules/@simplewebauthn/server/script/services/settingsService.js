"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsService = void 0;
const convertCertBufferToPEM_js_1 = require("../helpers/convertCertBufferToPEM.js");
const android_safetynet_js_1 = require("./defaultRootCerts/android-safetynet.js");
const android_key_js_1 = require("./defaultRootCerts/android-key.js");
const apple_js_1 = require("./defaultRootCerts/apple.js");
const mds_js_1 = require("./defaultRootCerts/mds.js");
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
                newCertificates.push((0, convertCertBufferToPEM_js_1.convertCertBufferToPEM)(cert));
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
exports.SettingsService = new BaseSettingsService();
// Initialize default certificates
exports.SettingsService.setRootCertificates({
    identifier: 'android-key',
    certificates: [
        android_key_js_1.Google_Hardware_Attestation_Root_1,
        android_key_js_1.Google_Hardware_Attestation_Root_2,
        android_key_js_1.Google_Hardware_Attestation_Root_3,
        android_key_js_1.Google_Hardware_Attestation_Root_4,
    ],
});
exports.SettingsService.setRootCertificates({
    identifier: 'android-safetynet',
    certificates: [android_safetynet_js_1.GlobalSign_Root_CA],
});
exports.SettingsService.setRootCertificates({
    identifier: 'apple',
    certificates: [apple_js_1.Apple_WebAuthn_Root_CA],
});
exports.SettingsService.setRootCertificates({
    identifier: 'mds',
    certificates: [mds_js_1.GlobalSign_Root_CA_R3],
});
