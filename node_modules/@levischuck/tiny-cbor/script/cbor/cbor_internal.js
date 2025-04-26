"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeLength = exports.MAJOR_TYPE_SIMPLE_OR_FLOAT = exports.MAJOR_TYPE_TAG = exports.MAJOR_TYPE_MAP = exports.MAJOR_TYPE_ARRAY = exports.MAJOR_TYPE_TEXT_STRING = exports.MAJOR_TYPE_BYTE_STRING = exports.MAJOR_TYPE_NEGATIVE_INTEGER = exports.MAJOR_TYPE_UNSIGNED_INTEGER = exports.decodeLength = void 0;
function decodeLength(data, argument, index) {
    if (argument < 24) {
        return [argument, 1];
    }
    const remainingDataLength = data.byteLength - index - 1;
    const view = new DataView(data.buffer, index + 1);
    let output;
    let bytes = 0;
    switch (argument) {
        case 24: {
            if (remainingDataLength > 0) {
                output = view.getUint8(0);
                bytes = 2;
            }
            break;
        }
        case 25: {
            if (remainingDataLength > 1) {
                output = view.getUint16(0, false);
                bytes = 3;
            }
            break;
        }
        case 26: {
            if (remainingDataLength > 3) {
                output = view.getUint32(0, false);
                bytes = 5;
            }
            break;
        }
        case 27: {
            if (remainingDataLength > 7) {
                const bigOutput = view.getBigUint64(0, false);
                // Bound it to [24, MAX_SAFE_INTEGER], where it is safe
                // to encode as a javascript number
                if (bigOutput >= 24n && bigOutput <= Number.MAX_SAFE_INTEGER) {
                    return [Number(bigOutput), 9];
                }
            }
            break;
        }
    }
    if (output && output >= 24) {
        return [output, bytes];
    }
    throw new Error("Length not supported or not well formed");
}
exports.decodeLength = decodeLength;
exports.MAJOR_TYPE_UNSIGNED_INTEGER = 0;
exports.MAJOR_TYPE_NEGATIVE_INTEGER = 1;
exports.MAJOR_TYPE_BYTE_STRING = 2;
exports.MAJOR_TYPE_TEXT_STRING = 3;
exports.MAJOR_TYPE_ARRAY = 4;
exports.MAJOR_TYPE_MAP = 5;
exports.MAJOR_TYPE_TAG = 6;
exports.MAJOR_TYPE_SIMPLE_OR_FLOAT = 7;
function encodeLength(major, argument) {
    const majorEncoded = major << 5;
    if (argument < 0) {
        throw new Error("CBOR Data Item argument must not be negative");
    }
    // Convert to bigint first.
    // Encode integers around and above 32 bits in big endian / network byte order
    // is unreliable in javascript.
    // https://tc39.es/ecma262/#sec-bitwise-shift-operators
    // Bit shifting operations result in 32 bit signed numbers
    let bigintArgument;
    if (typeof argument == "number") {
        if (!Number.isInteger(argument)) {
            throw new Error("CBOR Data Item argument must be an integer");
        }
        bigintArgument = BigInt(argument);
    }
    else {
        bigintArgument = argument;
    }
    // Negative 0 is not a thing
    if (major == exports.MAJOR_TYPE_NEGATIVE_INTEGER) {
        if (bigintArgument == 0n) {
            throw new Error("CBOR Data Item argument cannot be zero when negative");
        }
        bigintArgument = bigintArgument - 1n;
    }
    if (bigintArgument > 18446744073709551615n) {
        throw new Error("CBOR number out of range");
    }
    // Encode into 64 bits and extract the tail
    const buffer = new Uint8Array(8);
    const view = new DataView(buffer.buffer);
    view.setBigUint64(0, bigintArgument, false);
    if (bigintArgument <= 23) {
        return [majorEncoded | buffer[7]];
    }
    else if (bigintArgument <= 255) {
        return [majorEncoded | 24, buffer[7]];
    }
    else if (bigintArgument <= 65535) {
        return [majorEncoded | 25, ...buffer.slice(6)];
    }
    else if (bigintArgument <= 4294967295) {
        return [
            majorEncoded | 26,
            ...buffer.slice(4),
        ];
    }
    else {
        return [
            majorEncoded | 27,
            ...buffer,
        ];
    }
}
exports.encodeLength = encodeLength;
