import type { CredentialDeviceType } from '../types/index.js';
/**
 * Make sense of Bits 3 and 4 in authenticator indicating:
 *
 * - Whether the credential can be used on multiple devices
 * - Whether the credential is backed up or not
 *
 * Invalid configurations will raise an `Error`
 */
export declare function parseBackupFlags({ be, bs }: {
    be: boolean;
    bs: boolean;
}): {
    credentialDeviceType: CredentialDeviceType;
    credentialBackedUp: boolean;
};
export declare class InvalidBackupFlags extends Error {
    constructor(message: string);
}
//# sourceMappingURL=parseBackupFlags.d.ts.map