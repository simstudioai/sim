"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toAuthenticatorAttachment = toAuthenticatorAttachment;
const attachments = ['cross-platform', 'platform'];
/**
 * If possible coerce a `string` value into a known `AuthenticatorAttachment`
 */
function toAuthenticatorAttachment(attachment) {
    if (!attachment) {
        return;
    }
    if (attachments.indexOf(attachment) < 0) {
        return;
    }
    return attachment;
}
