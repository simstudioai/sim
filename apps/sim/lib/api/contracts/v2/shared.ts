import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { LIST_SORT_ORDERS, type ListSortOrder } from '@/lib/api/list-query'
import { FORBIDDEN_DETAIL_CODES } from '@/lib/core/application/forbidden'
import {
  FolderPathError,
  MAX_FOLDER_PATH_BYTES,
  MAX_FOLDER_PATH_SEGMENTS,
  parseFolderPath,
  requireNonRootFolderPath,
} from '@/lib/folders/paths'

/**
 * Shared building blocks for the v2 API contract surface.
 *
 * v2 standardizes on a single response family across every endpoint:
 * - single resource:   `{ data: T }`
 * - list:              `{ data: T[], nextCursor: string | null }`
 * - error:             `{ error: { code, message, details? } }`
 *
 * Every v2 route uses that error family, including the two that are not
 * published: the local-storage upload data plane — `PUT /api/v2/uploads/{uploadId}`
 * and `PUT /api/v2/uploads/{uploadId}/parts/{partNumber}`. Those two are
 * authenticated by a short-lived upload token rather than an API key and are
 * deliberately absent from the public OpenAPI specs (see
 * `UNDOCUMENTED_V2_ROUTES` in `scripts/check-openapi-specs.ts`), because their
 * URL is signed, short-lived, and only ever reached through a documented
 * operation's response. Not being in the document is a reason not to publish a
 * route; it is not a reason to answer in a different shape. What that step
 * promises — method, headers, `204`, and which codes mean what — is published on
 * `transfer.url` in `contracts/v2/uploads.ts`.
 *
 * Every list returns the opaque-cursor envelope (Stripe/Slack-style)
 * `{ data, nextCursor }`, but not every list is *paged*. A paged list also
 * accepts `limit` + `cursor` and can return a non-null `nextCursor`; a list
 * whose result set is small and bounded by construction accepts neither and
 * returns the whole set as one page with `nextCursor` always `null`. Sharing
 * the envelope regardless is what lets a full-set list gain real pages later
 * without a contract change: the cursor is opaque, so the scheme behind it
 * (keyset / offset / full-set) is not part of the interface.
 * Total counts are not returned on lists — they're available on the parent
 * resource where relevant (e.g. `rowCount` on a table, `docCount` on a KB).
 *
 * Rate-limit state is carried in `X-RateLimit-*` response headers (not the
 * body). Usage limits are available from the dedicated usage endpoint rather
 * than being inlined into every response.
 *
 * ## Search, filtering, and sorting
 *
 * One convention, applied by every v2 list that sorts on a selectable column.
 * It is deliberately the narrow
 * scalar-param form the app's own list endpoints already speak — not a third
 * dialect alongside the Logs filter set and the Tables predicate grammar.
 * A list that needs a real expression tree (Tables) keeps its own `POST /query`.
 *
 * Two lists predate the convention and are the documented exceptions:
 * `GET /api/v2/logs` and `GET /api/v2/workflows/{workflowId}/runs` have no `sortBy`
 * (the sort column is fixed to execution start time) and spell the direction
 * `order`, not `sortOrder`. They are not a pattern to copy, and renaming the
 * param would break shipped callers.
 *
 * - **`search`** ({@link v2SearchSchema}) — a case-insensitive substring match
 *   against the resource's *single* natural name field, and nothing else:
 *   `name` for files/folders/workflows/tables/knowledge bases/MCP servers/
 *   skills/credential providers, `title` for custom tools, `filename` for
 *   knowledge documents (`GET /knowledge/{knowledgeBaseId}/documents`), and `displayName`
 *   for both credentials and secrets (`GET /secrets`, where the secret's name
 *   *is* the credential `displayName`). It never matches ids, descriptions, or
 *   content. `%` and `_` in the term are matched literally, not as wildcards.
 *   Empty is rejected rather than silently ignored — omit the param instead.
 * - **`sortBy` + `sortOrder`** ({@link v2SortFields}) — `sortBy` is a
 *   per-resource enum, never a free string, because the value selects a column
 *   in the query. `sortOrder` is `asc`/`desc`. Both always have a default, so
 *   an omitted sort is a defined order rather than whatever the planner
 *   returns. `position` names a resource's stored manual arrangement (the
 *   `sortOrder` *column* on workflows and folders) — it is spelled differently
 *   from the `sortOrder` *param* on purpose.
 * - **Filters** — resource-specific and enumerated, reusing the names already
 *   on the surface (`scope`, `folderPath`, `deployedOnly`, `type`, `providerId`,
 *   `resourceType`). No generic filter expression. A filter value that matches
 *   nothing is an empty page, never an error — including a `folderPath` naming
 *   no folder ({@link V2_FOLDER_FILTER_MISS}).
 *
 * ## Blank query values
 *
 * A param sent with no value (`?limit=`, `?search=`, `?limit=%20`) is a 400
 * naming it, enforced for every param at the surface by
 * `V2_PARSE_DEFAULTS.rejectBlankQueryValues` — see
 * `blankQueryValueValidationError` for why a schema cannot see the difference.
 *
 * Every one of these is pushed into SQL, except on `GET /skills` (which narrows the
 * static builtin registry with the same search term, merges it into the DB rows,
 * then re-sorts the merged array), `GET /files/folders` (which applies
 * `parentPath` and `search` in JS; its sort is pushed into SQL like every other
 * folder list), and `GET /credentials/providers` (whose bounded catalog is
 * assembled from code-defined registries before its caller-specific
 * availability is projected). These read a full result set to produce a page;
 * none is a pattern to copy.
 *
 * ## Which lists are paged
 *
 * The authoritative split is pinned in `v2/__tests__/list-pagination.test.ts`,
 * not restated here. A full-set list returns `nextCursor: null` on every
 * response — its OpenAPI description says so explicitly, so a caller never
 * writes a pagination loop that can only ever run once.
 *
 * Every list whose result set grows with workspace content is now paged —
 * including `GET /mcp-servers`, since nothing caps how many servers a workspace
 * registers. What remains full-set is bounded by construction rather than by a
 * caller's `limit`: the four folder lists, whose trees are capped where they
 * load; `GET /knowledge/{knowledgeBaseId}/tags`, capped by the fixed tag-slot table;
 * `GET /mcp-servers/{mcpServerId}/tools`, capped by tool discovery itself; and
 * `GET /tables/{tableId}/views` and `GET /tables/{tableId}/groups`, capped per
 * table; and the credential-provider catalog, bounded by code-defined OAuth
 * and service-account registries.
 *
 * Adding `limit`/`cursor` to a full-set list is additive, but giving it a
 * *default* `limit` truncates callers reading the whole set today, so once v2 is
 * generally available that change needs a version bump.
 *
 * Three cursor schemes are in use. Two are shared codecs in
 * `app/api/v2/lib/response.ts`, and which of them a list uses is decided by what
 * its read can express rather than by preference: a keyset
 * (`encodeSortedCursor`) wherever the page comes from one ordered SQL read, and
 * an offset (`encodeOffsetCursor`) only where it cannot — `GET /skills`, which
 * merges the static builtin registry into the DB rows and re-sorts in JS, and
 * `GET /knowledge/{knowledgeBaseId}/documents`, whose underlying query is limit/offset.
 * Prefer the keyset; an offset needs that kind of reason.
 *
 * The third is per-domain: a list whose read predates the shared codecs, or
 * whose page boundary is not expressible as one, mints its own — a bare
 * `encodeCursor({ version })` on `GET /workflows/{workflowId}/versions` and
 * `encodeCursor({ email })` on the workspace member list, the audit-log and run-log
 * codecs in `lib/audit-logs/query.ts` and `lib/logs/list-logs.ts`, the table-row
 * codec in `lib/table/rows/cursor.ts`, and a usage-event id passed straight
 * through by `GET /billing/logs`. Those tokens stay opaque and untouched, but the
 * three whose sequence a caller can re-filter are wrapped in
 * `encodeScopedCursor` at the surface so they carry the same query binding as
 * the shared schemes. A new list should still reach for one of the two shared
 * codecs rather than adding a fourth.
 *
 * ## Query binding and the opaque cursor
 *
 * Every paged list stamps its sort and its filters into the token it returns and
 * re-checks them on the way back in; replaying a cursor under a different
 * `sortBy`/`sortOrder` or a changed filter is a 400 naming which half changed.
 * What belongs in a stamp, and why `limit` and response-shaping params do not,
 * is documented on `cursorScopeKey` in `lib/api/cursor-binding.ts`.
 *
 * The authoritative per-list binding is pinned in
 * `v2/__tests__/list-pagination.test.ts`, which fails when a list gains a param
 * that is neither bound nor explicitly exempted. The two lists whose token is
 * minted by a domain codec (`GET /audit-logs`, `GET /billing/logs`) get the same
 * binding by wrapping that token in a query-stamped envelope.
 */

/**
 * Canonical v2 timestamp: a strict ISO-8601 UTC instant, exactly what
 * `Date.prototype.toISOString()` emits.
 *
 * What this buys over a bare `z.string().meta({ format: 'date-time' })` is
 * *runtime* validation, not documentation. Both render the same OpenAPI schema
 * — `format: date-time` comes from the `meta`, so a generated client parses
 * either one as a date — and roughly two dozen v2 fields use the bare form,
 * including {@link v2FolderSchema} below and most of `contracts/v2/workflows.ts`.
 * The real difference is that `.datetime()` also *asserts* the shape, and a v2
 * response body is `.parse`d on the way out
 * (`lib/api/server/routes/v2-json-route.ts`), so asserting a field a producer
 * does not actually emit as ISO-8601 turns a successful read into a 500.
 *
 * Use this schema wherever every producer of the field provably emits
 * `toISOString()` output — most commonly a `Date` column projected straight
 * through. Keep the bare form for a value that is persisted as text,
 * reconstructed from a third party, or otherwise may have drifted: the document
 * is identical, and a lenient read beats a 500. Tightening an existing field
 * means proving the producer first.
 */
export const v2TimestampSchema = z.string().datetime().meta({ format: 'date-time' })

/** Canonical absolute browser URL for a resource with a stable workspace UI destination. */
export const v2ResourceWebUrlSchema = z
  .string()
  .url()
  .describe('Canonical absolute URL for opening this resource in the Sim web application.')

export const v2ForbiddenDetailCodeSchema = z.enum(FORBIDDEN_DETAIL_CODES).meta({
  id: 'V2ForbiddenDetailCode',
  title: 'Forbidden detail code',
  description: 'Stable cause code for an actionable `403` response.',
})

const v2ActionableForbiddenDetailsSchema = z
  .object({ code: v2ForbiddenDetailCodeSchema })
  .catchall(z.unknown().describe('Additional context for this refusal.'))
  .meta({
    id: 'V2ActionableForbiddenDetails',
    title: 'Actionable forbidden details',
    description: 'Machine-readable cause and optional context for an actionable `403` response.',
  })

/** Canonical v2 error envelope. */
export const v2ErrorResponseSchema = z.object({
  error: z
    .object({
      code: z.string().describe('Stable machine-readable error code.'),
      message: z.string().describe('Human-readable explanation of the error.'),
      details: z
        .union([
          v2ActionableForbiddenDetailsSchema,
          z.unknown().describe('Other structured context defined by the specific error.'),
        ])
        .optional()
        .describe(
          'Structured error context whose keys depend on the error. Actionable `403` responses use the `V2ActionableForbiddenDetails` shape; validation failures may return issue arrays instead.'
        ),
    })
    .describe('Canonical error details.'),
})

export type V2ErrorResponse = z.output<typeof v2ErrorResponseSchema>

/** `{ data: T }` */
export const v2DataResponse = <T extends z.ZodType>(dataSchema: T) =>
  z.object({ data: dataSchema.describe('Response data.') })

interface V2ListResponseOptions {
  /**
   * `false` for a full-set list — one that shares the envelope but declares no
   * `cursor`/`limit` and always answers `null`. Defaults to `true`.
   */
  paged?: boolean
}

/**
 * `{ data: T[], nextCursor: string | null }` — the v2 list envelope.
 *
 * `paged` selects the `nextCursor` documentation, and exists because the two
 * cases had been publishing the same sentence. A full-set list accepts no
 * `cursor` param — its query schema is `.strict()`, so the token the envelope
 * told the caller to "send back as `cursor`" is a `400` — and its `nextCursor`
 * is `null` by construction, so the instruction described a loop that could
 * never run. The envelope stays shared either way: that is what lets a
 * full-set list gain real pages later without a contract change.
 */
export const v2CursorListResponse = <T extends z.ZodType>(
  itemSchema: T,
  options: V2ListResponseOptions = {}
) =>
  z.object({
    data: z.array(itemSchema).describe('Items in the current page.'),
    nextCursor: z
      .string()
      .nullable()
      .describe(
        options.paged === false
          ? 'Always `null` — this list has no `cursor` or `limit` param and returns its whole bounded set in one page. Present so the list can gain pages later without a shape change.'
          : 'Opaque cursor for the next page. Send it back as `cursor`; `null` means there is nothing further to fetch. Never construct one yourself.'
      ),
  })

/**
 * Default and maximum page size for a v2 paged list.
 *
 * These are the values the majority of already-paged v2 lists shipped with
 * (`/workflows`, `/workflows/{workflowId}/versions`, `/workflows/{workflowId}/runs`,
 * `/workspaces/{id}/members`, `/billing/logs`), so they are what a list adopting
 * pagination now inherits.
 */
export const V2_DEFAULT_PAGE_SIZE = 50
export const V2_MAX_PAGE_SIZE = 100

/**
 * How a `limit` outside `1..max` is handled.
 *
 * `reject` is the rule for every list: an out-of-range or fractional page size
 * is a 400 naming the bound. `clamp` exists only for the three lists that
 * shipped truncating and clamping instead (`/files`, `/logs`, `/tables`) and
 * published that leniency in their OpenAPI description — flipping them to
 * `reject` would turn a currently-successful request into an error for callers
 * already relying on it. New lists must use `reject`; `clamp` is not a pattern
 * to copy and should be collapsed into `reject` at the next major version.
 */
export type V2LimitOutOfRange = 'reject' | 'clamp'

interface V2LimitOptions {
  max?: number
  /** Page size applied when the caller omits `limit`. */
  fallback?: number
  /** Defaults to `reject`. */
  outOfRange?: V2LimitOutOfRange
  /** Overrides the generated `describe()` text. */
  description?: string
}

/**
 * The v2 `limit` param, as one schema so the family cannot drift per route.
 *
 * It exists because it already drifted: `GET /api/v2/workflows` was copied from
 * a sibling and lost its `.int()`, so a fractional `limit` passed validation and
 * reached Postgres as `LIMIT 2.5`, which is a 500. A caller-supplied query value
 * must never be able to produce a 500, and the only durable fix is for every
 * list to derive its bound from one place rather than restating it.
 *
 * `z.coerce.number()` is what accepts the query string at all, so JS numeric
 * parsing applies (`1e2` is 100, `0x10` is 16, surrounding whitespace is
 * ignored). That leniency is inherited from the coercion, not chosen here; the
 * bounds below are what actually constrain the value.
 */
export function v2LimitSchema(options: V2LimitOptions = {}) {
  const {
    max = V2_MAX_PAGE_SIZE,
    fallback = V2_DEFAULT_PAGE_SIZE,
    outOfRange = 'reject',
    description,
  } = options

  /**
   * The bounds are appended rather than left to the caller's sentence, so a
   * per-list `description` cannot drop them from the published parameter — the
   * numbers a caller needs are the ones this schema actually enforces.
   */
  const bounds =
    outOfRange === 'clamp'
      ? `Values outside 1–${max} are truncated and clamped into that range rather than rejected. Defaults to ${fallback}.`
      : `Must be a whole number from 1 to ${max}. Defaults to ${fallback}.`
  const described = `${description ?? 'Maximum items to return per page.'} ${bounds}`

  const base = z.coerce.number({ error: 'limit must be a number' })

  if (outOfRange === 'clamp') {
    return (
      base
        .optional()
        .default(fallback)
        .transform((value) => Math.min(Math.max(1, Math.trunc(value)), max))
        .describe(described)
        /**
         * `minimum`/`maximum` are deliberately absent. In JSON Schema they mean
         * "rejected outside", and this branch clamps instead — publishing them
         * made a generated SDK refuse locally a `limit` the server would have
         * accepted and silently corrected. The range lives in the description,
         * which is where a clamped bound belongs.
         */
        .meta({ type: 'integer' })
    )
  }

  return base
    .int('limit must be a whole number')
    .min(1, 'limit must be at least 1')
    .max(max, `limit cannot exceed ${max}`)
    .optional()
    .default(fallback)
    .describe(described)
}

/**
 * The `limit` + `cursor` pair for a paged v2 list. Spread into a query object;
 * a list that returns `nextCursor` must accept both, and must actually apply
 * them.
 *
 * `cursor` is the opaque token a previous page returned as `nextCursor`. Empty
 * is rejected rather than treated as "start over", so a caller that accidentally
 * forwards an empty string learns about it instead of looping on page one.
 */
export function v2PaginationFields(options: V2LimitOptions = {}) {
  return {
    limit: v2LimitSchema(options),
    cursor: z
      .string()
      .min(1, 'cursor must be a non-empty token')
      .optional()
      .describe(
        'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.'
      ),
  }
}

/**
 * The v2 `search` term: a case-insensitive substring match on the resource's
 * natural name field. Bounded at 200 characters — a longer term cannot match
 * any of the name columns it is aimed at, and every one of these matches is an
 * unindexed scan.
 */
/**
 * A run-window bound, for the two collections that filter on run start time.
 *
 * Both bounds are constructed into `Date`s by their route and reach the query as
 * bound timestamps, so an unparseable value would arrive as an `Invalid Date`
 * and fail inside the driver's timestamp mapper — a caller-reachable 500.
 * Validating the format here is what keeps that a 400.
 *
 * The form is `z.datetime()`, which is UTC-only: a date with no time
 * (`2026-08-06`) and an offset-bearing timestamp (`2026-08-06T00:00:00+02:00`)
 * are both rejected. `GET /logs` and `GET /workflows/{workflowId}/runs` are sibling
 * reads over the same runs, so the same timestamp must work on both — sharing
 * the schema is what makes that true rather than merely intended, and it is why
 * the descriptions say "UTC ISO 8601" instead of overpromising "ISO 8601".
 *
 * Format alone is not enough, which is why the year is checked on top of it.
 * `date-time` publishes a four-digit year, so `0000-01-01T00:00:00Z` is a
 * spec-valid value that `Date` parses happily — but the proleptic Gregorian
 * calendar Postgres implements has no year zero, so the resulting bind parameter
 * is refused by the server rather than by anything in the request path, and the
 * caller sees a 500 for a request the published schema told it to send. Year
 * `0001` upward is storable and stays accepted, which leaves `0000` the single
 * value the format admits and the column cannot hold.
 */
export function v2RunWindowBoundSchema(field: 'startDate' | 'endDate') {
  const boundary = field === 'startDate' ? 'at or after' : 'at or before'
  return z
    .string()
    .datetime({ error: `${field} must be a UTC ISO 8601 timestamp, e.g. 2026-08-06T00:00:00Z` })
    .refine((value) => new Date(value).getUTCFullYear() >= 1, {
      error: `${field} must name a storable instant; there is no year 0000`,
    })
    .describe(
      `Only include runs started ${boundary} this UTC ISO 8601 timestamp, e.g. \`2026-08-06T00:00:00Z\`. A date without a time, or a timestamp carrying a UTC offset instead of \`Z\`, is rejected, as is year \`0000\`, which names no storable instant.`
    )
    .meta({ format: 'date-time' })
}

/**
 * The single `order` param `GET /workflows/{workflowId}/runs` takes in place of
 * `sortBy` + `sortOrder`, because start time is the only column it can order by.
 *
 * `GET /logs` used to be its twin here. It is not any more: it reads the same
 * rows but can also order them by duration, cost, and status, so it publishes
 * the ordinary `sortBy` + `sortOrder` pair. The two remain sibling reads and
 * still share {@link v2RunWindowBoundSchema}, so a timestamp that works on one
 * works on the other — only the ordering vocabulary differs, and it differs
 * because the sortable sets genuinely differ.
 *
 * The member order is {@link LIST_SORT_ORDERS}, the same one `sortOrder`
 * publishes everywhere else, so the two spellings cannot drift apart in the
 * generated specs and read as two APIs.
 */
export function v2RunOrderSchema(subject: 'execution' | 'run') {
  return z
    .enum(LIST_SORT_ORDERS)
    .optional()
    .default('desc')
    .describe(
      `Sort direction by ${subject} start time. This list is sortable only by ${subject} start time, so it takes \`order\` in place of \`sortBy\`/\`sortOrder\`, which it rejects.`
    )
}

/**
 * Longest caller-supplied substring any v2 search accepts. Every one of them
 * compiles to an unindexed `ILIKE` scan, so the term itself has to be bounded
 * wherever it is accepted — including the searches that are not name searches.
 */
export const V2_SEARCH_MAX_LENGTH = 200

/**
 * Added to `sortBy` wherever a text name column is sortable.
 *
 * Name ordering is `ORDER BY` on the stored text with no `COLLATE` and no
 * `lower()`, so it is whatever the server database's collation does — under a
 * `C`-collated deployment that is byte order, which puts every capitalized name
 * ahead of every lowercase one. Nothing in the API pins the collation, so the
 * spec must not promise one; what it can promise is that Sim does not case-fold,
 * which is the part a caller gets wrong.
 */
export function nameSortCollation(field = 'name') {
  return `Sorting by \`${field}\` is case-sensitive and follows the storage collation, so do not rely on a case-insensitive order.`
}

export const v2SearchSchema = z
  .string()
  .trim()
  .min(1, 'search cannot be empty')
  .max(V2_SEARCH_MAX_LENGTH, 'search is too long')
  .optional()
  .describe('Case-insensitive substring match against the resource name.')

/**
 * Appended to every list folder-filter description.
 *
 * A folder filter is a filter: a path naming no active folder narrows the result
 * to nothing, exactly as `workflowIds` naming no workflow does. These lists used
 * to answer `404 Folder not found` instead, which reported a missing collection
 * for a collection that exists, broke a pagination walk when a folder was
 * deleted mid-walk, and made a list a folder-existence oracle. The folder lists
 * answer a non-matching `parentPath` the same way, so one rule covers every
 * folder filter in the family. Mutations keep their 404 — creating into or
 * moving to a folder that does not exist has no empty-set reading.
 */
export const V2_FOLDER_FILTER_MISS = 'Unknown folder paths contribute no matches.'

export const v2SortOrderSchema = z.enum(LIST_SORT_ORDERS).describe('Sort direction.')

/**
 * The closed vocabulary `z.stringbool()` accepts, restated here only so the
 * generated spec can publish it — Zod's defaults are internal to the library
 * and contribute nothing to the JSON Schema. `shared.test.ts` pins each spelling
 * against the schema so a Zod upgrade that changes the set fails here.
 */
export const V2_TRUE_VALUES = ['true', '1', 'yes', 'on', 'y', 'enabled'] as const
export const V2_FALSE_VALUES = ['false', '0', 'no', 'off', 'n', 'disabled'] as const

export type V2SortOrder = ListSortOrder

function canonicalFolderPathSchema(parser: (path: string) => string[]) {
  return z.string().superRefine((path, ctx) => {
    try {
      parser(path)
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message:
          error instanceof FolderPathError ? error.message : 'Path must be a canonical folder path',
      })
    }
  })
}

/**
 * The canonical-path rule, published once on the two folder-path components
 * every folder family references rather than restated per operation.
 *
 * `canonicalFolderPathSchema` validates through `superRefine`, which
 * contributes nothing to JSON Schema, so a folder path shipped as an
 * unconstrained `string`: the percent-encoding, the rejections, and both caps
 * were invisible to a spec-driven client. `maxLength` is the byte cap measured
 * on the *encoded* form, so it is an upper bound on characters rather than a
 * character count — a name outside the unreserved set spends up to twelve
 * bytes per source character.
 */
const FOLDER_PATH_FORMAT = `Segments are percent-encoded, so a folder shown as "New folder" is \`/New%20folder\`: everything outside \`A-Z a-z 0-9 - _ . ~\` is escaped as uppercase hex, and only that exact encoding is accepted. A trailing slash, an empty segment, and a literal \`.\` or \`..\` segment are rejected. At most ${MAX_FOLDER_PATH_SEGMENTS} segments and ${MAX_FOLDER_PATH_BYTES} encoded bytes.`

/** Canonical slash-prefixed folder path. `/` is the workspace root. */
export const v2FolderPathSchema = canonicalFolderPathSchema(parseFolderPath).meta({
  title: 'Folder path',
  description: `Canonical slash-prefixed folder path. \`/\` is the workspace root. ${FOLDER_PATH_FORMAT}`,
  maxLength: MAX_FOLDER_PATH_BYTES,
})
export type V2FolderPath = z.output<typeof v2FolderPathSchema>

/** Canonical path that identifies a real folder rather than the virtual root. */
export const v2NonRootFolderPathSchema = canonicalFolderPathSchema(requireNonRootFolderPath).meta({
  title: 'Non-root folder path',
  description: `Canonical slash-prefixed path identifying a real folder rather than the root. ${FOLDER_PATH_FORMAT}`,
  maxLength: MAX_FOLDER_PATH_BYTES,
})

function normalizeFolderPathInput(path: string): string {
  return path.length === 0 || path.startsWith('/') ? path : `/${path}`
}

/** Input path that accepts an omitted leading slash and emits the canonical form. */
export const v2FolderPathInputSchema = z
  .string()
  .transform(normalizeFolderPathInput)
  .pipe(v2FolderPathSchema)
  .meta({
    id: 'FolderPathInput',
    title: 'Folder path input',
    description: `Folder path. A missing leading slash is normalized before validation. ${FOLDER_PATH_FORMAT}`,
    maxLength: MAX_FOLDER_PATH_BYTES,
  })

/** Non-root input path that accepts an omitted leading slash and emits the canonical form. */
export const v2NonRootFolderPathInputSchema = z
  .string()
  .transform(normalizeFolderPathInput)
  .pipe(v2NonRootFolderPathSchema)
  .meta({
    id: 'NonRootFolderPathInput',
    title: 'Non-root folder path input',
    description: `Non-root folder path. A missing leading slash is normalized before validation. ${FOLDER_PATH_FORMAT}`,
    maxLength: MAX_FOLDER_PATH_BYTES,
  })

export const v2FolderSchema = z
  .object({
    name: z.string().describe('Folder name.'),
    path: v2NonRootFolderPathSchema.describe(
      'Canonical folder path used as the public folder identifier.'
    ),
    parentPath: v2FolderPathSchema.describe('Canonical parent path; `/` is the root.'),
    createdAt: z
      .string()
      .describe('ISO 8601 timestamp when the folder was created.')
      .meta({ format: 'date-time' }),
    updatedAt: z
      .string()
      .describe('ISO 8601 timestamp when the folder was last updated.')
      .meta({ format: 'date-time' }),
  })
  .meta({
    id: 'V2Folder',
    title: 'Folder',
    description: 'A canonical workspace folder.',
  })
export type V2Folder = z.output<typeof v2FolderSchema>

export const v2FolderSortFields = ['name', 'createdAt', 'updatedAt'] as const

export const v2ListFoldersQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace whose folders should be listed.'),
    parentPath: v2FolderPathInputSchema
      .optional()
      .describe(
        `Restrict results to direct children of this parent path. ${V2_FOLDER_FILTER_MISS}`
      ),
    search: v2SearchSchema.describe('Case-insensitive substring match against the folder name.'),
    ...v2SortFields(v2FolderSortFields, { sortBy: 'name', sortOrder: 'asc' }),
  })
  .strict()

export const v2CreateFolderBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace in which to create the folder.'),
    path: v2NonRootFolderPathInputSchema.describe('Path of the folder to create.'),
  })
  .strict()

export const v2RelocateFolderBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace containing the folder.'),
    path: v2NonRootFolderPathInputSchema.describe('Current folder path.'),
    destinationPath: v2NonRootFolderPathInputSchema.describe(
      'New full path for the folder and its descendants.'
    ),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.path === body.destinationPath) {
      ctx.addIssue({
        code: 'custom',
        path: ['destinationPath'],
        message: 'destinationPath must differ from path',
      })
    }
  })

export const v2DeleteFolderQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace containing the folder.'),
    path: v2NonRootFolderPathInputSchema.describe('Path of the folder to delete.'),
    /**
     * Published as an enum rather than the bare `type: string` `z.stringbool()`
     * emits. This is the difference between deleting one empty folder and
     * deleting a subtree, and the accepted vocabulary is closed — an
     * out-of-vocabulary value is a `400`, not a silent `false` — so leaving it
     * undeclared hid a destructive switch behind a guess.
     *
     * `case: 'sensitive'` is what makes "closed" true. `z.stringbool()` folds
     * case by default, so the server honoured `recursive=True`, `TRUE`, `YES`
     * and `ENABLED` as a recursive delete while publishing only the twelve
     * lowercase spellings — a generated client validates against the `enum` and
     * would reject a request the server would have executed destructively.
     * Accepting exactly what is published is the safe direction to close that
     * gap: an unpublished spelling now fails the request instead of deleting a
     * subtree.
     */
    recursive: z
      .stringbool({ case: 'sensitive' })
      .prefault('false')
      .describe(
        "Delete the folder's nested files and folders too. An empty folder deletes either way; a non-empty one needs this. The listed spellings are the whole accepted vocabulary and are case-sensitive; any other value is rejected."
      )
      .meta({ enum: [...V2_TRUE_VALUES, ...V2_FALSE_VALUES] }),
  })
  .strict()

/**
 * The `sortBy` + `sortOrder` pair for one resource. `fields` is the closed set
 * of sortable fields — the value reaches the query as a column, so it can never
 * be a free string — and both params always resolve to the given defaults.
 */
export function v2SortFields<const F extends readonly [string, ...string[]]>(
  fields: F,
  defaults: { sortBy: F[number]; sortOrder: V2SortOrder }
) {
  const sortByDescription = fields.includes('name')
    ? `Field used to sort the result. ${nameSortCollation()}`
    : 'Field used to sort the result.'
  return {
    sortBy: z.enum(fields).default(defaults.sortBy).describe(sortByDescription),
    sortOrder: v2SortOrderSchema.default(defaults.sortOrder).describe('Sort direction.'),
  }
}
