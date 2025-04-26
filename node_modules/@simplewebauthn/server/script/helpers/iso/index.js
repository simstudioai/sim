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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isoUint8Array = exports.isoCrypto = exports.isoCBOR = exports.isoBase64URL = void 0;
/**
 * A collection of methods for isomorphic manipulation of trickier data types
 *
 * The goal with these is to make it easier to replace dependencies later that might not play well
 * with specific server-like runtimes that expose global Web APIs (CloudFlare Workers, Deno, Bun,
 * etc...), while also supporting execution in Node.
 */
exports.isoBase64URL = __importStar(require("./isoBase64URL.js"));
exports.isoCBOR = __importStar(require("./isoCBOR.js"));
exports.isoCrypto = __importStar(require("./isoCrypto/index.js"));
exports.isoUint8Array = __importStar(require("./isoUint8Array.js"));
