"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AsnSchemaValidationError = void 0;
class AsnSchemaValidationError extends Error {
    constructor() {
        super(...arguments);
        this.schemas = [];
    }
}
exports.AsnSchemaValidationError = AsnSchemaValidationError;
