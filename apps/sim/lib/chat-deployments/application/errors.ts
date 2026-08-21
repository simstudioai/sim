import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/**
 * The requested chat identifier is already taken by another live deployment.
 *
 * A distinct class rather than a bare conflict because the two surfaces answer
 * it differently: the public API reports the `409` the condition actually is,
 * while the internal editor keeps the `400` it has always sent, which its
 * client recognises. A shared error policy cannot tell one conflict from
 * another, so the distinction has to be a type rather than a message.
 */
export class ChatIdentifierInUseError extends OrchestrationError {
  constructor(message = 'Identifier already in use') {
    super('conflict', message)
    this.name = 'ChatIdentifierInUseError'
  }
}

/**
 * The partial unique index the `chat` table enforces the identifier on.
 *
 * `uniqueIndex('identifier_idx') ON chat (identifier) WHERE archived_at IS NULL`
 * in the schema. Matched by name so an unrelated `23505` on this table — one
 * a future index introduces — is not mislabelled as an identifier collision.
 */
const CHAT_IDENTIFIER_UNIQUE_INDEX = 'identifier_idx'

/**
 * Classifies a write that lost the identifier race.
 *
 * Every identifier check in this domain is a check-then-act: the read that
 * proves an identifier free and the write that claims it are separate
 * statements, so two callers claiming the same identifier concurrently both
 * pass the check and the second one's `INSERT`/`UPDATE` trips
 * {@link CHAT_IDENTIFIER_UNIQUE_INDEX}. The database is what actually holds the
 * invariant; the pre-check only turns the common case into a clean refusal.
 *
 * Unclassified, that loss surfaced as an unhandled driver error and therefore
 * as a `500` — a caller-supplied value producing a server fault, which the v2
 * surface treats as its highest-severity defect class. It is the same condition
 * the pre-check already reports, so it answers the same `409`.
 *
 * Anything else propagates untouched: a foreign-key or not-null violation is a
 * real fault and must not be reported back as the caller's conflict.
 */
export function chatIdentifierUniquenessConflict(identifier: string) {
  return (error: unknown): never => {
    if (
      getPostgresErrorCode(error) === '23505' &&
      getPostgresConstraintName(error) === CHAT_IDENTIFIER_UNIQUE_INDEX
    ) {
      throw new ChatIdentifierInUseError(
        `The identifier "${identifier}" was claimed by another chat deployment; choose a different identifier.`
      )
    }
    throw error
  }
}
