import { UserFailure } from '@/lib/core/errors/user-failure'

/** A block the author left without a value it requires, refused before execution starts. */
export class MissingRequiredFieldsError extends UserFailure {
  constructor(blockName: string, missingFields: string[]) {
    super(`${blockName} is missing required fields: ${missingFields.join(', ')}`)
  }
}
