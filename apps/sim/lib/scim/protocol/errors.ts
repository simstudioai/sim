import { OrchestrationError } from '@/lib/core/orchestration/types'
import { SCIM_ERROR_SCHEMA } from '@/lib/scim/protocol/constants'

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

function isLockTimeout(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === PG_LOCK_NOT_AVAILABLE
  )
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

  if (isLockTimeout(error)) {
    return new ScimError(503, undefined, 'The organization is busy; retry shortly', {
      'Retry-After': '5',
    })
  }

  if (error instanceof OrchestrationError) {
    switch (error.code) {
      case 'not_found':
        return new ScimError(404, undefined, error.message)
      case 'conflict':
        return new ScimError(409, 'uniqueness', error.message)
      case 'forbidden':
        return new ScimError(403, undefined, error.message)
      case 'validation':
        return new ScimError(400, 'invalidValue', error.message)
      case 'locked':
        return new ScimError(503, undefined, error.message, { 'Retry-After': '5' })
      default:
        return new ScimError(500, undefined, 'Internal server error')
    }
  }

  return new ScimError(500, undefined, 'Internal server error')
}
