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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cose = void 0;
__exportStar(require("./convertAAGUIDToString.js"), exports);
__exportStar(require("./convertCertBufferToPEM.js"), exports);
__exportStar(require("./convertCOSEtoPKCS.js"), exports);
__exportStar(require("./decodeAttestationObject.js"), exports);
__exportStar(require("./decodeClientDataJSON.js"), exports);
__exportStar(require("./decodeCredentialPublicKey.js"), exports);
__exportStar(require("./generateChallenge.js"), exports);
__exportStar(require("./generateUserID.js"), exports);
__exportStar(require("./getCertificateInfo.js"), exports);
__exportStar(require("./isCertRevoked.js"), exports);
__exportStar(require("./parseAuthenticatorData.js"), exports);
__exportStar(require("./toHash.js"), exports);
__exportStar(require("./validateCertificatePath.js"), exports);
__exportStar(require("./verifySignature.js"), exports);
__exportStar(require("./iso/index.js"), exports);
exports.cose = __importStar(require("./cose.js"));
