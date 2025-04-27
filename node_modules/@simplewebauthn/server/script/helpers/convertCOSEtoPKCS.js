"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertCOSEtoPKCS = convertCOSEtoPKCS;
const index_js_1 = require("./iso/index.js");
const cose_js_1 = require("./cose.js");
/**
 * Takes COSE-encoded public key and converts it to PKCS key
 */
function convertCOSEtoPKCS(cosePublicKey) {
    // This is a little sloppy, I'm using COSEPublicKeyEC2 since it could have both x and y, but when
    // there's no y it means it's probably better typed as COSEPublicKeyOKP. I'll leave this for now
    // and revisit it later if it ever becomes an actual problem.
    const struct = index_js_1.isoCBOR.decodeFirst(cosePublicKey);
    const tag = Uint8Array.from([0x04]);
    const x = struct.get(cose_js_1.COSEKEYS.x);
    const y = struct.get(cose_js_1.COSEKEYS.y);
    if (!x) {
        throw new Error('COSE public key was missing x');
    }
    if (y) {
        return index_js_1.isoUint8Array.concat([tag, x, y]);
    }
    return index_js_1.isoUint8Array.concat([tag, x]);
}
