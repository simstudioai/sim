"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvalidBackupFlags = void 0;
exports.parseBackupFlags = parseBackupFlags;
/**
 * Make sense of Bits 3 and 4 in authenticator indicating:
 *
 * - Whether the credential can be used on multiple devices
 * - Whether the credential is backed up or not
 *
 * Invalid configurations will raise an `Error`
 */
function parseBackupFlags({ be, bs }) {
    const credentialBackedUp = bs;
    let credentialDeviceType = 'singleDevice';
    if (be) {
        credentialDeviceType = 'multiDevice';
    }
    if (credentialDeviceType === 'singleDevice' && credentialBackedUp) {
        throw new InvalidBackupFlags('Single-device credential indicated that it was backed up, which should be impossible.');
    }
    return { credentialDeviceType, credentialBackedUp };
}
class InvalidBackupFlags extends Error {
    constructor(message) {
        super(message);
        this.name = 'InvalidBackupFlags';
    }
}
exports.InvalidBackupFlags = InvalidBackupFlags;
