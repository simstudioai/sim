import { getPostgresErrorCode } from '@sim/utils/errors'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { SCIM_ERROR_SCHEMA } from '@/ee/scim/lib/protocol/constants'

/**
 * The `scimType` vocabulary of RFC 7644 section 3.12.
 *
 * A provider branches on this, not on the message: Okta reports a `uniqueness`
 * conflict as an existing user and retries nothing, while it treats an
 * unlabelled 409 as a transient failure worth retrying for the rest of the sync.
 */
export type ScimType =
  | 'invalidFilter'
  | 'tooMany'
  | 'uniqueness'
  | 'mutability'
  | 'invalidSyntax'
  | 'invalidPath'
  | 'noTarget'
  | 'invalidValue'
  | 'invalidVers'
  | 'sensitive'

export interface ScimErrorBody {
  schemas: [typeof SCIM_ERROR_SCHEMA]
  /** RFC 7644 carries the status as a string inside the body as well. */
  status: string
  scimType?: ScimType
  detail: string
}

/** A refusal rendered in the envelope RFC 7644 requires. */
export class ScimError extends Error {
  constructor(
    readonly status: number,
    readonly scimType: ScimType | undefined,
    detail: string,
    readonly headers?: Record<string, string>
  ) {
    super(detail)
    this.name = 'ScimError'
  }

  get body(): ScimErrorBody {
    return {
      schemas: [SCIM_ERROR_SCHEMA],
      status: String(this.status),
      ...(this.scimType ? { scimType: this.scimType } : {}),
      detail: this.message,
    }
  }
}

export function scimErrorBody(
  status: number,
  scimType: ScimType | undefined,
  detail: string
): ScimErrorBody {
  return new ScimError(status, scimType, detail).body
}

/** A value the provider sent is not one this attribute accepts. */
export function invalidValue(detail: string): ScimError {
  return new ScimError(400, 'invalidValue', detail)
}

/** The provider addressed an attribute path this server does not implement. */
export function invalidPath(detail: string): ScimError {
  return new ScimError(400, 'invalidPath', detail)
}

/** The provider tried to write an attribute the server owns. */
export function mutability(detail: string): ScimError {
  return new ScimError(400, 'mutability', detail)
}

/** A filtered operation matched nothing and the operation cannot create one. */
export function noTarget(detail: string): ScimError {
  return new ScimError(400, 'noTarget', detail)
}

/** The filter expression is outside the grammar this server supports. */
export function invalidFilter(detail: string): ScimError {
  return new ScimError(400, 'invalidFilter', detail)
}

/** A uniqueness constraint the provider must resolve on its side. */
export function uniqueness(detail: string): ScimError {
  return new ScimError(409, 'uniqueness', detail)
}

export function notFound(detail: string): ScimError {
  return new ScimError(404, undefined, detail)
}

/**
 * PostgreSQL's lock-not-available code, raised when an advisory lock waiter hits
 * `lock_timeout`. It means "try again", not "your request was wrong".
 */
const PG_LOCK_NOT_AVAILABLE = '55P03'

/** PostgreSQL's unique-violation code: a concurrent write beat this one to a key. */
const PG_UNIQUE_VIOLATION = '23505'

/** PostgreSQL's deadlock code: the loser was rolled back and should simply retry. */
const PG_DEADLOCK_DETECTED = '40P01'

function isLockContention(error: unknown): boolean {
  const code = getPostgresErrorCode(error)
  return code === PG_LOCK_NOT_AVAILABLE || code === PG_DEADLOCK_DETECTED
}

/**
 * Two provisioning requests for the same key can race past every pre-check;
 * the unique index is the arbiter. RFC 7644 calls that a `uniqueness` conflict,
 * and the label matters: Okta stops retrying on `uniqueness` and treats an
 * unlabelled failure as transient.
 */
function isUniqueViolation(error: unknown): boolean {
  return getPostgresErrorCode(error) === PG_UNIQUE_VIOLATION
}

/**
 * Renders any failure as a SCIM error.
 *
 * Domain failures arrive as {@link OrchestrationError} from the shared
 * membership and permission primitives, which know nothing about SCIM. Mapping
 * them here rather than at each throw site keeps those primitives usable by the
 * UI, which needs the same failures rendered as ordinary HTTP.
 */
export function toScimError(error: unknown): ScimError {
  if (error instanceof ScimError) return error

  if (isLockContention(error)) {
    return new ScimError(503, undefined, 'The organization is busy; retry shortly', {
      'Retry-After': '5',
    })
  }
  if (isUniqueViolation(error)) {
    return new ScimError(409, 'uniqueness', 'A resource with the same identifier already exists')
  }

  const orchestration = asOrchestrationError(error)
  if (orchestration) {
    switch (orchestration.code) {
      case 'not_found':
        return new ScimError(404, undefined, orchestration.message)
      /** A conflict that is not a duplicate carries no `scimType`; `uniqueness` is reserved for duplicates. */
      case 'conflict':
        return new ScimError(409, undefined, orchestration.message)
      case 'forbidden':
        return new ScimError(403, undefined, orchestration.message)
      case 'validation':
        return new ScimError(400, 'invalidValue', orchestration.message)
      case 'locked':
        return new ScimError(503, undefined, orchestration.message, { 'Retry-After': '5' })
      default:
        return new ScimError(500, undefined, 'Internal server error')
    }
  }

  return new ScimError(500, undefined, 'Internal server error')
}
