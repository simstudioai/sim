export class AsnSchemaValidationError extends Error {
    constructor() {
        super(...arguments);
        this.schemas = [];
    }
}
