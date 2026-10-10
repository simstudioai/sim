/**
 * A block the author left without a value it requires. Raised before execution starts; the
 * author's configuration, not a Sim fault, so execution logs it at info.
 */
export class MissingRequiredFieldsError extends Error {
  constructor(blockName: string, missingFields: string[]) {
    super(`${blockName} is missing required fields: ${missingFields.join(', ')}`)
    this.name = 'MissingRequiredFieldsError'
  }
}
