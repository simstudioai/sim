export interface ApiClientErrorOptions {
  status: number
  message: string
  body: unknown
  rawBody?: string
  code?: string
}

export class ApiClientError extends Error {
  readonly status: number
  readonly body: unknown
  readonly rawBody?: string
  readonly code?: string

  constructor(options: ApiClientErrorOptions) {
    super(options.message)
    this.name = 'ApiClientError'
    this.status = options.status
    this.body = options.body
    this.rawBody = options.rawBody
    this.code = options.code
  }
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError
}

export interface ValidationIssue {
  /** Path of the failing field, e.g. ['updates', 'name']. */
  path: ReadonlyArray<string | number>
  /** Human-readable message — uses the schema's custom error string when set. */
  message: string
}

interface UnknownIssue {
  path?: unknown
  message?: unknown
}

function normalizeIssue(raw: unknown): ValidationIssue | null {
  if (!raw || typeof raw !== 'object') return null
  const { path, message } = raw as UnknownIssue
  if (typeof message !== 'string' || message.length === 0) return null
  if (!Array.isArray(path)) return null
  const cleanPath = path.filter(
    (segment): segment is string | number =>
      typeof segment === 'string' || typeof segment === 'number'
  )
  return { path: cleanPath, message }
}

/**
 * Pull a list of validation issues out of an unknown error. Recognises both
 * shapes the boundary produces:
 *
 * - Client-side contract validation: `requestJson` calls `schema.parse(input)`
 *   before fetch; failure throws a raw `ZodError` whose `.issues` is the array.
 * - Server-side contract validation: route returns `{ error, details: [...] }`,
 *   which `requestJson` re-throws as `ApiClientError` carrying the body.
 *
 * Returns an empty array when the error isn't a recognised validation shape so
 * callers can fall back to toast/log paths.
 */
export function extractValidationIssues(error: unknown): ValidationIssue[] {
  if (!error || typeof error !== 'object') return []

  if (isApiClientError(error)) {
    const body = error.body
    if (body && typeof body === 'object') {
      const details = (body as { details?: unknown }).details
      if (Array.isArray(details)) {
        return details.map(normalizeIssue).filter((i): i is ValidationIssue => i !== null)
      }
    }
    return []
  }

  const issues = (error as { issues?: unknown }).issues
  if (Array.isArray(issues)) {
    return issues.map(normalizeIssue).filter((i): i is ValidationIssue => i !== null)
  }
  return []
}

/**
 * Match a single issue by suffix path. `pathSuffix` lets callers ignore the
 * outer body wrapper — `findValidationIssue(err, ['name'])` matches both
 * `path: ['name']` and `path: ['updates', 'name']`.
 */
export function findValidationIssue(
  error: unknown,
  pathSuffix: ReadonlyArray<string | number>
): ValidationIssue | null {
  const issues = extractValidationIssues(error)
  for (const issue of issues) {
    if (issue.path.length < pathSuffix.length) continue
    const tail = issue.path.slice(issue.path.length - pathSuffix.length)
    if (tail.every((segment, i) => segment === pathSuffix[i])) return issue
  }
  return null
}

/** True when the error is a recognised validation failure (client or server). */
export function isValidationError(error: unknown): boolean {
  return extractValidationIssues(error).length > 0
}
