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
  BadRequest: {
    status: 400,
    description:
      'The request is invalid. This includes a query parameter sent with no value (`?limit=`, `?search=`), which is rejected rather than read as zero, empty, or the parameter default — omit the parameter instead.',
  },
  Unauthorized: { status: 401, description: 'The API key is missing or invalid.' },
  UsageLimitExceeded: {
    status: 402,
    description: 'The workspace has exceeded its usage or billing limits.',
  },
  Forbidden: { status: 403, description: FORBIDDEN_DESCRIPTION },
  NotFound: { status: 404, description: 'The requested resource was not found.' },
  Conflict: { status: 409, description: 'The request conflicts with current resource state.' },
  RunIdConflict: {
    status: 409,
    description:
      'The run cannot be started. Two causes share this status, distinguished by `error.details.code`: `RUN_ID_CONFLICT` when the supplied `X-Run-Id` is already associated with a different request, and `CALL_CHAIN_DEPTH_EXCEEDED` when the incoming `X-Sim-Via` chain has already reached the maximum workflow-to-workflow call depth.',
    headers: ['X-Run-Id'],
  },
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
   * `POST /workflows/{id}/execute` is the exception because there an abort
   * leaves *residue*: the run may keep going and bill, so the response carries
   * `error.details.runId` for the caller to reconcile against once it reconnects.
   * That is caller-actionable information about state that outlives the
   * connection, which is what makes it worth documenting. Anywhere else an abort
   * leaves nothing behind to reconcile. Publish a 499 on a new operation only
   * when the same is true of it.
   */
  ClientClosedRequest: {
    status: 499,
    description:
      'The client closed the connection before the response was produced. The response is written to a connection that is already gone, so the caller that caused it never reads it; it is documented only on operations where an abort can leave work running. There, `error.details.runId` carries the run id — reconcile against the runs resource rather than starting another run.',
  },
  InternalError: { status: 500, description: 'An unexpected server error occurred.' },
  ServiceUnavailable: {
    status: 503,
    description:
      'A required service is temporarily unavailable. The condition is transient, so the response normally carries `Retry-After` with the number of seconds to wait; treat that value as a floor and add jitter before retrying. One case deliberately omits the header: when `error.details.code` is `ASYNC_ENQUEUE_AMBIGUOUS`, the run may already have started, so retrying could start and bill a second run. Reconcile against the returned run id instead of retrying.',
    headers: ['Retry-After'],
  },
} as const satisfies Readonly<Record<string, OpenApiErrorResponse>>

export type ErrorResponseId = keyof typeof ERROR_RESPONSES

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
 * The two sets below add the `413` that every body-carrying operation can emit.
 *
 * It is not a property of the resource but of the request: `parseRequest` reads
 * the JSON body through `parseJsonBody` under `DEFAULT_MAX_JSON_BODY_BYTES`
 * before schema validation runs, and the v2 builders supply
 * `V2_PARSE_DEFAULTS.payloadTooLargeResponse`, so a body over
 * the cap is answered `413` on any route whose contract declares one. That made
 * `413` reachable-but-unpublished across a whole family, which is the mirror of
 * the defect these sets exist to prevent — a caller cannot handle a status the
 * spec never mentions.
 *
 * Reachability is not automatic, so these are opt-in rather than folded into the
 * base sets. An operation with no request body cannot emit this `413` at all,
 * and neither can one whose handler reads its payload through a path that
 * applies no cap; documenting it there would publish a response that can never
 * arrive.
 */
export const RESOURCE_BODY_ERRORS = [
  ...RESOURCE_ERRORS,
  'PayloadTooLarge',
] as const satisfies readonly ErrorResponseId[]

/** {@link RESOURCE_CONFLICT_ERRORS} plus the body-size `413`. */
export const RESOURCE_CONFLICT_BODY_ERRORS = [
  ...RESOURCE_CONFLICT_ERRORS,
  'PayloadTooLarge',
] as const satisfies readonly ErrorResponseId[]

export const V2_API_KEY_SECURITY = [{ apiKey: [] }] as const

export const V2_API_KEY_SECURITY_SCHEMES = {
  apiKey: {
    type: 'apiKey',
    in: 'header',
    name: 'X-API-Key',
    description:
      'Your Sim API key, sent on every request. Create one in the Sim dashboard under Settings, then API Keys. Keys are either personal or workspace-scoped. A workspace-scoped key is refused by operations that act on behalf of a specific person — administrative reads, secret access, and irreversible or governance-affecting writes — no matter what role the key carries; each of those operations says so in its own description. Such a refusal is a 403, or a 404 where the operation conceals resources the caller cannot reach. Use a personal API key for those.',
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
 * Appended to a list whose result set is bounded by construction, so it answers
 * in one page.
 *
 * Every v2 list returns `{ data, nextCursor }`, so a caller cannot tell a
 * single-page list from a paged one by shape alone. Saying so once keeps the
 * eight such operations from drifting into eight paraphrases of the same
 * promise. The authoritative membership is pinned in
 * `contracts/v2/__tests__/list-pagination.test.ts` as `FULL_SET_LISTS`.
 */
export const FULL_SET_LIST =
  'The bounded set is returned in one page with `nextCursor` always null; there is no second page to fetch.'

/**
 * Appended to a `GET` whose route declares `headSafe: false` because the read
 * has an effect — an outbound connection, or an audit event.
 *
 * The sentence this replaced promised the opposite of what the route now does.
 * The short-circuit used to sit between admission and parsing, so a `HEAD`
 * returned a bodiless `200` for an id the same caller's `GET` answered `403` or
 * `404` for — an existence oracle. `defineV2JsonRoute`/`defineV2BinaryRoute`
 * now admit, parse, and authorize a `HEAD` through the use case's `authorize`
 * phase before answering it bodiless, so its refusals mirror the `GET`'s.
 * Pinned by `contracts/v2/openapi/head-not-safe.test.ts`.
 */
export const HEAD_MIRRORS_GET =
  'A `HEAD` skips the effect but is authorized exactly as the `GET` is, so it answers `400`, `401`, `403`, or `404` wherever the `GET` would and an empty `200` otherwise. Skipping the effect means skipping the read that produces the payload, so that `200` carries none of the response headers documented below — it answers whether the `GET` would be allowed, not what the `GET` would return.'

/**
 * Appended where the skipped payload headers are the ones a caller is most
 * likely to have wanted from a `HEAD`.
 *
 * `Content-Length` on a `HEAD` is the standard way to size a download before
 * fetching it, and this surface cannot serve it: the byte length comes from the
 * same read that records the download audit event, which is the effect
 * `headSafe: false` exists to skip. Naming the alternative is the difference
 * between a documented limitation and a caller discovering an absent header at
 * runtime.
 */
export const HEAD_OMITS_PAYLOAD_HEADERS =
  'In particular a `HEAD` does not report `Content-Length`, so it cannot be used to size a download in advance; read the size from the file resource instead.'

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
 * tombstone or a 404, it is simply absent, and `runCount` on the workflow is
 * never decremented to match — so a free-plan workflow can report dozens of
 * runs beside an empty list and nothing in either response explains the gap.
 * Kept as one constant so the two sibling reads cannot drift into two
 * paraphrases of one window.
 */
export const RUN_RETENTION =
  "Runs are hard-deleted once they pass the payer's log retention window, so an older run is absent from this list rather than reported as removed. The window is 30 days from run start on the free plan; Pro and Team have none configured and keep runs indefinitely; Enterprise sets its own per organization, with an optional per-workspace override, and is also unbounded until configured. A workflow's `runCount` is never reduced by this deletion, so a workflow can report runs while this list is empty."

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
        'Seconds to wait before retrying. Sent on `429` (derived from the caller rate-limit window) and on `503` (a fixed transient-failure floor). Add jitter rather than retrying at exactly this offset.',
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
