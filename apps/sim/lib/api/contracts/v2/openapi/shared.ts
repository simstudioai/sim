import { z } from 'zod'
import { V2_ERROR_CODE_BY_STATUS } from '@/lib/api/contracts/v2/error-codes'
import { v2ErrorResponseSchema } from '@/lib/api/contracts/v2/shared'
import type {
  OpenApiErrorResponse,
  OpenApiHeader,
  OpenApiRouteDefinition,
  OpenApiSecurityScheme,
} from '@/lib/api/openapi/types'

interface ErrorResponseOptions {
  /**
   * The `message` a caller actually receives for this status. Every one below is a literal
   * the runtime emits — the generic path for that status, not a domain's phrasing of it —
   * so the reference can be read as the response rather than as an illustration.
   */
  message: string
  /** `error.details`, for the statuses that populate it. Omitted where none is sent. */
  details?: unknown
  headers?: readonly string[]
}

/**
 * One documented error response, with `error.code` derived from the status rather than
 * restated beside it.
 *
 * Deriving is what keeps the reference honest: a hand-written pair can drift into naming a
 * code the status never carries, and that mistake reads as authoritative. The v2 codes map
 * one-to-one onto statuses ({@link V2_ERROR_CODE_BY_STATUS} throws if that ever stops being
 * true), so the status is
 * enough to determine the code.
 */
function errorResponse(
  status: number,
  description: string,
  { message, details, headers }: ErrorResponseOptions
): OpenApiErrorResponse {
  const code = V2_ERROR_CODE_BY_STATUS[status]
  if (!code) {
    throw new Error(
      `No v2 error code is sent with status ${status}; documenting it would publish a response the API cannot produce.`
    )
  }
  return {
    status,
    description,
    ...(headers ? { headers } : {}),
    example: { error: { code, message, ...(details === undefined ? {} : { details }) } },
  }
}

export const RATE_LIMIT_HEADERS = [
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
] as const

export const WORKSPACE_ERRORS = [
  'BadRequest',
  'Unauthorized',
  'Forbidden',
  'RateLimited',
  'InternalError',
  'ServiceUnavailable',
] as const

/**
 * The 403 description, assembled from the closed cause set rather than written
 * out, so a new code is published the moment it exists.
 *
 * Four remedies hide behind one status — raise a role, switch key kind,
 * re-point a workspace key, change the plan — and prose is not branchable, so a
 * 403 a caller can do something about names its cause in `error.details.code`.
 *
 * The wording is deliberately "where the cause is one a caller can act on"
 * rather than "always", and it must stay that way. The billing, secret, table-
 * quota, credential-list, and public-sharing refusals have been reparented onto
 * `ForbiddenOperationError` (the one cross-tenant refusal among them became a
 * concealed `404` instead, which is a status change rather than a code), but a
 * handful of domain refusals still throw a bare
 * `OrchestrationError('forbidden', …)` and reach the wire with no code — the
 * knowledge-base file-ownership guard deliberately, others because nothing in
 * the closed set fits them yet. Do not restate this as "every 403 names its
 * cause": the audit that produced these codes found the claim false, and it will
 * be false again the moment a domain adds a refusal without one.
 */
const FORBIDDEN_DESCRIPTION =
  'The caller lacks the rights this operation requires. When the cause is one a caller can act on, `error.details.code` names it. A resource in a workspace the caller cannot reach at all answers `404` instead, so absence and denial are indistinguishable.'

export const ERROR_RESPONSES = {
  BadRequest: errorResponse(
    400,
    'The request is invalid. This includes a query parameter sent with no value (`?limit=`, `?search=`), which is rejected rather than read as zero, empty, or the parameter default — omit the parameter instead.',
    {
      /**
       * The fallback `getValidationErrorMessage` uses when an issue carries no message of its
       * own; a real failure usually names the offending field instead (`limit must be at
       * least 1`). The generic form is documented because this response is shared by every
       * operation, and `details` is omitted because only the validation path populates it —
       * the cursor and malformed-JSON 400s send none.
       */
      message: 'Invalid request',
    }
  ),
  Unauthorized: errorResponse(401, 'The API credential is missing or invalid.', {
    message: 'Authentication required',
  }),
  UsageLimitExceeded: errorResponse(
    402,
    'The workspace has exceeded its usage or billing limits.',
    { message: 'Usage limit exceeded. Please upgrade your plan to continue.' }
  ),
  Forbidden: errorResponse(403, FORBIDDEN_DESCRIPTION, {
    message: 'Insufficient workspace permissions',
    /** The description tells callers to branch on this, so the example has to show it. */
    details: { code: 'INSUFFICIENT_WORKSPACE_ROLE' },
  }),
  NotFound: errorResponse(404, 'The requested resource was not found.', {
    /**
     * The surface-wide literal. A resource route answers with its own noun instead — `Workflow
     * not found`, `Table not found` — which this response cannot name because every domain
     * shares it.
     */
    message: 'Not found',
  }),
  Conflict: errorResponse(409, 'The request conflicts with current resource state.', {
    /**
     * The workflows phrasing, which is the default because that document does not override
     * it. Nothing in the response layer supplies a 409 message, so every other document
     * carrying this status names its own through {@link withErrorExamples}.
     */
    message: 'Webhook path already in use',
  }),
  RunIdConflict: errorResponse(
    409,
    'The run cannot be started, for one of two causes named by `error.details.code`: `RUN_ID_CONFLICT` when the supplied `X-Run-Id` is already claimed, and `CALL_CHAIN_DEPTH_EXCEEDED` when the incoming `X-Sim-Via` chain has reached the maximum workflow-to-workflow call depth.',
    {
      message: 'Run ID has already been used',
      details: { code: 'RUN_ID_CONFLICT', runId: '0f7c1a2e-9b3d-4c58-8a21-6d4e5f7a9b01' },
      headers: ['X-Run-Id'],
    }
  ),
  PayloadTooLarge: errorResponse(
    413,
    'The request, or a resource collection it must materialize, exceeds the allowed size: an oversized request body, a generated artifact past the download ceiling, or a workspace folder tree too large to load in full.',
    { message: 'Request body is too large' }
  ),
  UnsupportedMediaType: errorResponse(415, 'The request uses an unsupported media type.', {
    message: 'Request body must be sent as application/json',
  }),
  Locked: errorResponse(
    423,
    'The resource is temporarily locked or unavailable; retry the request.',
    {
      /**
       * Also domain-supplied. Workflows, tables and workspace files are the documents that carry
       * a `423`; tables names its own four lock kinds through {@link withErrorExamples}, and files
       * names the file and its search index.
       */
      message: 'Workflow is locked',
    }
  ),
  RateLimited: errorResponse(429, 'The caller exceeded the request rate limit.', {
    message: 'API rate limit exceeded',
    /** Mirrors `Retry-After`, which the description already sends callers to. */
    details: { retryAfter: '2026-01-01T00:00:30.000Z' },
    headers: ['Retry-After'],
  }),
  /**
   * Published on exactly one operation, and deliberately not on the rest.
   *
   * Every v2 JSON route can *emit* a 499: `defineV2JsonRoute` renders an
   * aborted request as `CLIENT_CLOSED_REQUEST`. But a 499 is written to a socket
   * the caller has already closed, so no conforming client ever reads it — it is
   * an observability record for Sim's own logs and its proxies, not a response
   * an SDK can branch on. Publishing it on every operation would add a branch to
   * every generated client that can never be taken.
   *
   * `POST /workflows/{workflowId}/execute` is the exception because there an abort
   * leaves *residue*: the run may keep going and bill, so the response carries
   * `error.details.runId` for the caller to reconcile against once it reconnects.
   * That is caller-actionable information about state that outlives the
   * connection, which is what makes it worth documenting. Anywhere else an abort
   * leaves nothing behind to reconcile. Publish a 499 on a new operation only
   * when the same is true of it.
   */
  ClientClosedRequest: errorResponse(
    499,
    'The client closed the connection before the response was produced. An abort can leave the run going, so `error.details.runId` carries the run id — reconcile against the runs resource rather than starting another run.',
    {
      message: 'Client cancelled request',
      /** The run this abort may have left running — the reason the status is published. */
      details: { runId: '0f7c1a2e-9b3d-4c58-8a21-6d4e5f7a9b01' },
    }
  ),
  InternalError: errorResponse(500, 'An unexpected server error occurred.', {
    /**
     * Hardcoded on every path. `v2ErrorForOrchestration` replaces a domain's `internal`
     * message with this literal, so a 500 never leaks one — the reference showing a
     * descriptive message here would suggest callers can parse something they never get.
     */
    message: 'Internal server error',
  }),
  ServiceUnavailable: errorResponse(
    503,
    'A required service is temporarily unavailable. `Retry-After` carries the seconds to wait; treat it as a floor and add jitter. The header is omitted when `error.details.code` is `ASYNC_ENQUEUE_AMBIGUOUS`, because the run may already have started — reconcile against the returned run id instead of retrying.',
    { message: 'Service temporarily unavailable', headers: ['Retry-After'] }
  ),
} as const satisfies Readonly<Record<string, OpenApiErrorResponse>>

export type ErrorResponseId = keyof typeof ERROR_RESPONSES

/**
 * {@link ERROR_RESPONSES} with a document's own body for the statuses whose message is the
 * domain's rather than the surface's.
 *
 * Most statuses read the same everywhere — a `401` is `Authentication required` whatever you were
 * asking for. `409` and `423` are not: nothing in the response layer supplies them, so the
 * only real strings are each domain's, and one shared example necessarily shows four of the
 * seven documents a message they never send. Tables answering `Workflow is locked` is the
 * same class of wrongness as every status answering `BAD_REQUEST`, just smaller.
 *
 * Status, description, and headers are kept — a document may restate what its errors *say*,
 * never what they *mean* — and the code is re-derived, so an override cannot introduce the
 * mismatch this whole mechanism exists to prevent.
 */
export function withErrorExamples(
  overrides: Partial<Record<ErrorResponseId, { message: string; details?: unknown }>>
): Record<ErrorResponseId, OpenApiErrorResponse> {
  const entries = Object.entries(ERROR_RESPONSES) as [ErrorResponseId, OpenApiErrorResponse][]
  return Object.fromEntries(
    entries.map(([id, response]) => {
      const override = overrides[id]
      if (!override) return [id, response]
      return [
        id,
        errorResponse(response.status, response.description, {
          message: override.message,
          details: override.details,
          headers: response.headers,
        }),
      ]
    })
  ) as Record<ErrorResponseId, OpenApiErrorResponse>
}

/**
 * The three sets below are the base shapes every workspace-scoped resource
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

/**
 * Adds the `413` a body-carrying operation can emit.
 *
 * `parseRequest` reads the JSON body under `DEFAULT_MAX_JSON_BODY_BYTES` before
 * schema validation, and the v2 builders supply
 * `V2_PARSE_DEFAULTS.payloadTooLargeResponse`, so an oversized body is a real
 * `413` on any route whose contract declares one — and a status a caller can
 * receive but the spec omits is an unhandled branch in every generated client.
 *
 * `415` is derived the same way and for the same reason: the JSON builder
 * answers `UNSUPPORTED_MEDIA_TYPE` for any body sent under a content type it
 * cannot read (`v2-json-route.ts`), so every route declaring a body can return
 * it, and none of them had said so.
 *
 * Derived from the contract rather than chosen per operation, so a new body
 * route cannot forget either. One-directional: it never removes a `413` from a
 * bodyless read, several of which publish one for the folder-tree ceiling.
 */
const BODY_DERIVED_ERRORS = [
  'PayloadTooLarge',
  'UnsupportedMediaType',
] as const satisfies readonly ErrorResponseId[]

/** @see BODY_DERIVED_ERRORS */
export function withRequestBodyErrors(route: OpenApiRouteDefinition): OpenApiRouteDefinition {
  if (!route.contract.body) return route
  const derived = route.operation.errors.slice()
  for (const code of BODY_DERIVED_ERRORS) {
    if (!derived.includes(code)) derived.push(code)
  }
  if (derived.length === route.operation.errors.length) return route
  return { ...route, operation: { ...route.operation, errors: derived } }
}

export const V2_AUTH_SECURITY = [{ apiKey: [] }, { oauthBearer: [] }] as const

export const V2_AUTH_SECURITY_SCHEMES = {
  apiKey: {
    type: 'apiKey',
    in: 'header',
    name: 'X-API-Key',
    description:
      'Your Sim API key, personal or workspace-scoped. Generate one under Settings, then API Keys. Operations that reject workspace keys say so in their own description.',
  },
  oauthBearer: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'OAuth 2.0 access token',
    description:
      'A Sim OAuth access token obtained by a registered client through the authorization-code flow. Each operation declares its required scope: api:read permits reads and searches; api:write also permits changes and execution and implies api:read. Scope requirements follow the application operation, independent of HTTP method or workspace role.',
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
export const FOLDER_TREE_TOO_LARGE = 'A workspace folder tree over 10,000 folders is a `413`.'

/**
 * Appended to a list whose result set is bounded by construction, so it answers
 * in one page.
 *
 * Every v2 list returns `{ data, nextCursor }`, so a caller cannot tell a
 * single-page list from a paged one by shape alone. Saying so once keeps the
 * eight such operations from drifting into eight paraphrases of the same
 * promise. The authoritative membership is pinned in
 * `contracts/v2/__tests__/list-pagination.test.ts` as `FULL_SET_LISTS`.
 */
export const FULL_SET_LIST = 'The bounded set is returned in one page; `nextCursor` is always null.'

/**
 * Appended to a `GET` whose route declares `headSafe: false` because the read
 * has an effect — an outbound connection, or an audit event.
 *
 * Pinned by `contracts/v2/openapi/head-not-safe.test.ts`.
 */
export const HEAD_MIRRORS_GET =
  '`HEAD` skips the effect but uses `GET` authorization, returning `400`, `401`, `403`, or `404`, or an empty `200` with no payload headers; confirms access only.'

/**
 * Appended where the skipped payload headers are the ones a caller is most
 * likely to have wanted from a `HEAD`.
 *
 * `Content-Length` on a `HEAD` is the standard way to size a download before
 * fetching it, and this surface cannot serve it: the byte length comes from the
 * same read that records the download audit event, which is the effect
 * `headSafe: false` exists to skip.
 */
export const HEAD_OMITS_PAYLOAD_HEADERS =
  '`HEAD` omits `Content-Length`; use file metadata to size downloads.'

/**
 * Appended to an operation whose semantic operation sets `workspaceApiKey: 'deny'`.
 * That policy is structural — an `admin` operation can never accept a workspace key —
 * so it is not something a workspace owner can grant around.
 */
export const WORKSPACE_API_KEY_DENIED =
  'Workspace API keys return `403`; use a personal API key or appropriately scoped OAuth token.'

/**
 * {@link WORKSPACE_API_KEY_DENIED} for an operation behind the resource-concealment
 * error policy, which rewrites the authorization failure to a not-found response so
 * the caller learns nothing about the resource.
 *
 * Published on no operation today: every one audited so far refuses a workspace
 * key through its principal-kind list, which raises an error the concealment
 * policy does not rewrite, so all of them say 403. Kept because a concealed
 * operation that denies the key through the policy itself would need this exact
 * wording, and because `scripts/openapi/documents.test.ts` asserts the file-share
 * description does not carry it — inlining the string there would let the guard
 * and the wording it guards drift apart.
 */
export const WORKSPACE_API_KEY_DENIED_AS_NOT_FOUND =
  'A workspace API key is rejected as `404` rather than `403`, because unauthorized resources are concealed; use a personal API key or an appropriately scoped OAuth token.'

/**
 * Appended to the two reads over `workflow_execution_logs`, which is the only
 * store of a run and is hard-deleted — rows and execution files both — by the
 * `cleanup-logs` background task once a run passes the payer's window.
 *
 * The window itself is `CLEANUP_CONFIG['cleanup-logs'].defaults` in
 * `lib/billing/cleanup-dispatcher.ts`: 30 days on the free plan, and `null`
 * — meaning the plan is skipped entirely and nothing is deleted — on Pro and
 * Team. Enterprise resolves per organization through
 * `resolveEffectiveRetentionHours`, with a per-workspace override, and is
 * likewise unbounded until someone configures it. Self-hosted classifies every
 * workspace as enterprise and dispatches nothing unless data retention is
 * enabled.
 *
 * Stated because deletion is otherwise invisible: an aged-out run is not a
 * tombstone or a 404, it is simply absent. The matching `runCount` caveat lives
 * on that field rather than here. Kept as one constant so the two sibling reads
 * cannot drift into two paraphrases of one window.
 */
export const RUN_RETENTION =
  'Expired runs are hard-deleted. Retention is 30 days from run start on Free, unbounded on Pro and Team, and configured per organization on Enterprise with an optional workspace override.'

/**
 * Response headers a binary download declares on top of the common set. Shared
 * so every document that publishes a byte-serving route describes the same
 * three headers identically.
 */
export const V2_BINARY_DOWNLOAD_HEADERS = {
  'Content-Type': {
    schema: z.string().meta({
      id: 'ContentTypeHeader',
      title: 'Content type',
      description:
        'MIME type of the file, defaulting to application/octet-stream when the stored type is unavailable.',
    }),
  },
  'Content-Disposition': {
    schema: z.string().meta({
      id: 'ContentDispositionHeader',
      title: 'Content disposition',
      description: 'Attachment disposition containing sanitized and RFC 5987 encoded filenames.',
    }),
  },
  'Content-Length': {
    schema: z
      .string()
      .regex(/^(0|[1-9]\d*)$/)
      .meta({
        id: 'ContentLengthHeader',
        title: 'Content length',
        description: 'File size in bytes.',
      }),
  },
} as const

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
      description:
        'Seconds to wait before retrying, sent on `429` and `503`. Add jitter rather than retrying at exactly this offset.',
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
