"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./methods/startRegistration.js"), exports);
__exportStar(require("./methods/startAuthentication.js"), exports);
__exportStar(require("./helpers/browserSupportsWebAuthn.js"), exports);
__exportStar(require("./helpers/platformAuthenticatorIsAvailable.js"), exports);
__exportStar(require("./helpers/browserSupportsWebAuthnAutofill.js"), exports);
__exportStar(require("./helpers/base64URLStringToBuffer.js"), exports);
__exportStar(require("./helpers/bufferToBase64URLString.js"), exports);
__exportStar(require("./helpers/webAuthnAbortService.js"), exports);
__exportStar(require("./helpers/webAuthnError.js"), exports);
__exportStar(require("./types/index.js"), exports);
