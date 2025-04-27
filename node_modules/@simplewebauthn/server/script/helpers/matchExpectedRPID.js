"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchExpectedRPID = matchExpectedRPID;
const toHash_js_1 = require("./toHash.js");
const index_js_1 = require("./iso/index.js");
/**
 * Go through each expected RP ID and try to find one that matches. Returns the unhashed RP ID
 * that matched the hash in the response.
 *
 * Raises an `UnexpectedRPIDHash` error if no match is found
 */
async function matchExpectedRPID(rpIDHash, expectedRPIDs) {
    try {
        const matchedRPID = await Promise.any(expectedRPIDs.map((expected) => {
            return new Promise((resolve, reject) => {
                (0, toHash_js_1.toHash)(index_js_1.isoUint8Array.fromASCIIString(expected)).then((expectedRPIDHash) => {
                    if (index_js_1.isoUint8Array.areEqual(rpIDHash, expectedRPIDHash)) {
                        resolve(expected);
                    }
                    else {
                        reject();
                    }
                });
            });
        }));
        return matchedRPID;
    }
    catch (err) {
        const _err = err;
        // This means no matches were found
        if (_err.name === 'AggregateError') {
            throw new UnexpectedRPIDHash();
        }
        // An unexpected error occurred
        throw err;
    }
}
class UnexpectedRPIDHash extends Error {
    constructor() {
        const message = 'Unexpected RP ID hash';
        super(message);
        this.name = 'UnexpectedRPIDHash';
    }
}
