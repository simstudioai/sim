import { z } from 'zod'
import { v2ErrorResponseSchema } from '@/lib/api/contracts/v2/shared'
import type {
  OpenApiErrorResponse,
  OpenApiHeader,
  OpenApiSecurityScheme,
} from '@/lib/api/openapi/types'

export const RATE_LIMIT_HEADERS = [
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
] as const

export const STANDARD_ERRORS = [
  'Unauthorized',
  'RateLimited',
  'InternalError',
  'ServiceUnavailable',
] as const

export const WORKSPACE_ERRORS = [
  'BadRequest',
  'Unauthorized',
  'Forbidden',
  'RateLimited',
  'InternalError',
  'ServiceUnavailable',
] as const

export const ERROR_RESPONSES = {
  BadRequest: { status: 400, description: 'The request is invalid.' },
  Unauthorized: { status: 401, description: 'The API key is missing or invalid.' },
  UsageLimitExceeded: {
    status: 402,
    description: 'The workspace has exceeded its usage or billing limits.',
  },
  Forbidden: { status: 403, description: 'The caller lacks access to the resource.' },
  NotFound: { status: 404, description: 'The requested resource was not found.' },
  Conflict: { status: 409, description: 'The request conflicts with current resource state.' },
  RunIdConflict: {
    status: 409,
    description:
      'The run cannot be started. Two causes share this status, distinguished by `error.details.code`: `RUN_ID_CONFLICT` when the supplied `X-Run-Id` is already associated with a different request, and `CALL_CHAIN_DEPTH_EXCEEDED` when the incoming `X-Sim-Via` chain has already reached the maximum workflow-to-workflow call depth.',
    headers: ['X-Run-Id'],
  },
  Gone: { status: 410, description: 'The requested generated resource has expired.' },
  PayloadTooLarge: {
    status: 413,
    description:
      'The request, or a resource collection it must materialize, exceeds the allowed size. Besides an oversized request body, this covers a generated artifact that renders past the download ceiling and a workspace folder tree too large to load in full.',
  },
  UnsupportedMediaType: {
    status: 415,
    description: 'The request uses an unsupported media type.',
  },
  Locked: { status: 423, description: 'The resource is locked and cannot be modified.' },
  RateLimited: {
    status: 429,
    description: 'The caller exceeded the request rate limit.',
    headers: ['Retry-After'],
  },
  ClientClosedRequest: {
    status: 499,
    description: 'The client closed the connection before the response was produced.',
  },
  InternalError: { status: 500, description: 'An unexpected server error occurred.' },
  ServiceUnavailable: {
    status: 503,
    description: 'A required service is temporarily unavailable.',
  },
} as const satisfies Readonly<Record<string, OpenApiErrorResponse>>

export type ErrorResponseId = keyof typeof ERROR_RESPONSES

/**
 * {@link STANDARD_ERRORS} plus the 400 that any operation parsing required path,
 * query, header, or body input returns when that input fails contract validation.
 * `STANDARD_ERRORS` alone is only correct for an operation with nothing to parse.
 */
export const VALIDATED_ERRORS = [
  'BadRequest',
  ...STANDARD_ERRORS,
] as const satisfies readonly ErrorResponseId[]

/**
 * The three sets below are the only shapes every workspace-scoped resource
 * operation in the v2 API actually emits, so they live here once rather than
 * being re-derived per domain. Eight per-domain aliases previously denoted these
 * same three sets under names that implied distinctions the generated spec never
 * had — responses are keyed by status, so two spellings of the same status set
 * produce byte-identical output.
 *
 * The base: an operation that resolves a workspace-scoped resource and can report
 * it missing.
 */
export const RESOURCE_ERRORS = [
  ...WORKSPACE_ERRORS,
  'NotFound',
] as const satisfies readonly ErrorResponseId[]

/**
 * {@link RESOURCE_ERRORS} plus the `409` a name collision, a duplicate or cyclic
 * folder destination, or a competing lifecycle state produces.
 */
export const RESOURCE_CONFLICT_ERRORS = [
  ...RESOURCE_ERRORS,
  'Conflict',
] as const satisfies readonly ErrorResponseId[]

/**
 * {@link RESOURCE_CONFLICT_ERRORS} plus the `423` a mutation lock raises — the
 * `lib/table/mutation-locks` asserts, the workflow-folder lock (the only folder
 * type with `supportsLocking`), and the delete-locked-table subtree guard.
 *
 * Reads, exports, and metadata edits never cross a lock assert, so they must use
 * one of the two narrower sets: a documented `423` an operation cannot emit is
 * worse than none.
 */
export const RESOURCE_MUTATION_ERRORS = [
  ...RESOURCE_CONFLICT_ERRORS,
  'Locked',
] as const satisfies readonly ErrorResponseId[]

export const V2_API_KEY_SECURITY = [{ apiKey: [] }] as const

export const V2_API_KEY_SECURITY_SCHEMES = {
  apiKey: {
    type: 'apiKey',
    in: 'header',
    name: 'X-API-Key',
    description:
      'Your Sim API key, personal or workspace-scoped. Generate one from the Sim dashboard under Settings > API Keys. A workspace API key is not accepted everywhere: operations that act on behalf of a specific human — administrative reads, secret access, and irreversible or governance-affecting writes — always reject it, whatever role the key carries. Each such operation says so in its own description, and the rejection surfaces as `403` unless the operation conceals unauthorized resources, in which case it is reported as `404`. Use a personal API key for those.',
  },
} as const satisfies Readonly<Record<string, OpenApiSecurityScheme>>

/**
 * Appended to an operation whose response must resolve a canonical folder path,
 * which requires loading the workspace's whole folder tree. The `413` is the
 * tree-size ceiling, not a request-body limit — see `ERROR_RESPONSES.PayloadTooLarge`.
 *
 * Operations that merely *accept* a `folderPath` and can emit the `413` without
 * rendering one back do not need this sentence: the shared `413` response
 * description already covers them.
 */
export const FOLDER_TREE_TOO_LARGE =
  'A workspace whose folder tree exceeds 10,000 folders is a 413, because the response needs the whole tree to render folder paths.'

/**
 * Appended to an operation whose semantic operation sets `workspaceApiKey: 'deny'`.
 * That policy is structural — an `admin` operation can never accept a workspace key —
 * so it is not something a workspace owner can grant around.
 */
export const WORKSPACE_API_KEY_DENIED =
  'A workspace API key cannot call this operation and is rejected with `403`; use a personal API key.'

/**
 * {@link WORKSPACE_API_KEY_DENIED} for an operation behind the resource-concealment
 * error policy, which rewrites the authorization failure to a not-found response so
 * the caller learns nothing about the resource.
 */
export const WORKSPACE_API_KEY_DENIED_AS_NOT_FOUND =
  'A workspace API key cannot call this operation. Because unauthorized resources are concealed, the rejection is reported as `404` rather than `403`; use a personal API key.'

export const V2_COMMON_HEADERS = {
  'X-RateLimit-Limit': {
    schema: z.number().int().nonnegative().meta({
      id: 'RateLimitLimitHeader',
      title: 'Rate limit',
      description: 'Maximum requests allowed in the current window.',
    }),
  },
  'X-RateLimit-Remaining': {
    schema: z.number().int().nonnegative().meta({
      id: 'RateLimitRemainingHeader',
      title: 'Rate limit remaining',
      description: 'Requests remaining in the current window.',
    }),
  },
  'X-RateLimit-Reset': {
    schema: z.string().datetime().meta({
      id: 'RateLimitResetHeader',
      title: 'Rate limit reset',
      description: 'ISO 8601 timestamp when the current rate-limit window resets.',
    }),
  },
  'Retry-After': {
    schema: z.number().int().nonnegative().meta({
      id: 'RetryAfterHeader',
      title: 'Retry after',
      description: 'Seconds to wait before retrying a rate-limited request.',
    }),
  },
  'X-Run-Id': {
    schema: z.string().min(1).meta({
      id: 'RunIdHeader',
      title: 'Run identifier',
      description: 'Identifier assigned to the workflow run.',
    }),
  },
} as const satisfies Readonly<Record<string, OpenApiHeader>>

export const V2_ERROR_SCHEMA = v2ErrorResponseSchema.meta({
  id: 'V2Error',
  title: 'v2 error response',
  description: 'Canonical error envelope returned by the public v2 API.',
  examples: [{ error: { code: 'BAD_REQUEST', message: 'The request is invalid.' } }],
})

export function documentedSchema<S extends z.ZodType | undefined>(
  schema: S,
  id: string,
  title: string,
  description: string,
  examples?: readonly unknown[]
): Exclude<S, undefined> {
  if (!schema) throw new Error(`Cannot document missing schema ${id}`)
  return schema.meta({ id, title, description, ...(examples ? { examples } : {}) }) as Exclude<
    S,
    undefined
  >
}
