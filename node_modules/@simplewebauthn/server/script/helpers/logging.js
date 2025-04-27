"use strict";
// const defaultLogger = debug('SimpleWebAuthn');
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLogger = getLogger;
/**
 * Generate an instance of a `debug` logger that extends off of the "simplewebauthn" namespace for
 * consistent naming.
 *
 * See https://www.npmjs.com/package/debug for information on how to control logging output when
 * using @simplewebauthn/server
 *
 * Example:
 *
 * ```
 * const log = getLogger('mds');
 * log('hello'); // simplewebauthn:mds hello +0ms
 * ```
 */
function getLogger(_name) {
    // This is a noop for now while I search for a better debug logger technique
    return (_message, ..._rest) => { };
}
