import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { LIST_SORT_ORDERS, type ListSortOrder } from '@/lib/api/list-query'
import { FolderPathError, parseFolderPath, requireNonRootFolderPath } from '@/lib/folders/paths'

/**
 * Shared building blocks for the v2 API contract surface.
 *
 * v2 standardizes on a single response family across every endpoint:
 * - single resource:   `{ data: T }`
 * - list:              `{ data: T[], nextCursor: string | null }`
 * - error:             `{ error: { code, message, details? } }`
 *
 * Every documented v2 operation uses that family. The two exceptions are the
 * local-storage upload data plane — `PUT /api/v2/uploads/{uploadId}` and
 * `PUT /api/v2/uploads/{uploadId}/parts/{partNumber}` — which emit a bare
 * `{ error: string }` body. They are authenticated by a short-lived upload
 * token rather than an API key, are deliberately absent from the public
 * OpenAPI specs (see `UNDOCUMENTED_V2_ROUTES` in
 * `scripts/check-openapi-specs.ts`), and are only ever reached through a URL
 * handed back by a documented operation, so no caller writes against them
 * from docs.
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
 * `GET /api/v2/logs` and `GET /api/v2/workflows/{id}/runs` have no `sortBy`
 * (the sort column is fixed to execution start time) and spell the direction
 * `order`, not `sortOrder`. They are not a pattern to copy, and renaming the
 * param would break shipped callers.
 *
 * - **`search`** ({@link v2SearchSchema}) — a case-insensitive substring match
 *   against the resource's *single* natural name field, and nothing else:
 *   `name` for files/folders/workflows/tables/knowledge bases/MCP servers/
 *   skills, `title` for custom tools, `filename` for knowledge documents
 *   (`GET /knowledge/{id}/documents`), and `displayName` for both credentials
 *   and secrets (`GET /secrets`, where the secret's name *is* the credential
 *   `displayName`). It never matches ids, descriptions, or content. `%` and `_` in the term are matched
 *   literally, not as wildcards. Empty is rejected rather than silently
 *   ignored — omit the param instead.
 * - **`sortBy` + `sortOrder`** ({@link v2SortFields}) — `sortBy` is a
 *   per-resource enum, never a free string, because the value selects a column
 *   in the query. `sortOrder` is `asc`/`desc`. Both always have a default, so
 *   an omitted sort is a defined order rather than whatever the planner
 *   returns. `position` names a resource's stored manual arrangement (the
 *   `sortOrder` *column* on workflows and folders) — it is spelled differently
 *   from the `sortOrder` *param* on purpose.
 * - **Filters** — resource-specific and enumerated, reusing the names already
 *   on the surface (`scope`, `folderPath`, `deployedOnly`, `type`, `providerId`,
 *   `resourceType`). No generic filter expression.
 *
 * Every one of these is pushed into SQL, except on `GET /skills` (which narrows the
 * static builtin registry with the same search term, merges it into the DB rows,
 * then re-sorts the merged array) and `GET /files/folders` (which applies `parentPath` and `search`
 * in JS; its sort is pushed into SQL like every other folder list). Both read a
 * full result set to produce a page; neither is a pattern to copy.
 *
 * ## Which lists are paged
 *
 * The authoritative split is pinned in `v2/__tests__/list-pagination.test.ts`,
 * not restated here. A full-set list returns `nextCursor: null` on every
 * response — its OpenAPI description says so explicitly, so a caller never
 * writes a pagination loop that can only ever run once.
 *
 * Every list whose result set grows with workspace content is now paged. What
 * remains full-set is the folder lists, whose trees are already capped where
 * they load, plus `GET /mcp-servers`.
 *
 * Adding `limit`/`cursor` to a full-set list is additive, but giving it a
 * *default* `limit` truncates callers reading the whole set today, so it is a
 * breaking change. Five lists took exactly that change while `v2-api` was off
 * in production and enabled only for a staging cohort — the window in which it
 * costs nothing. Once v2 is generally available, moving a shipped full-set list
 * to a defaulted page size needs a version bump.
 *
 * Both cursor schemes are opaque base64-JSON from `app/api/v2/lib/response.ts`,
 * and which one a list uses is decided by what its read can express rather than
 * by preference: a keyset (`encodeSortedCursor`) wherever the page comes from
 * one ordered SQL read, and an offset (`encodeCursor({ offset })`) only where it
 * cannot — `GET /skills`, which merges the static builtin registry into the DB
 * rows and re-sorts in JS, and `GET /knowledge/{id}/documents`, whose underlying
 * query is limit/offset. Prefer the keyset; an offset needs that kind of reason.
 *
 * ## Sort and the opaque cursor
 *
 * Lists using the shared keyset codec (`encodeSortedCursor` /
 * `decodeSortedCursor` in `app/api/v2/lib/response.ts`) carry a cursor that is
 * a keyset over the *active* sort, so its keys change when the sort does. The
 * sort is therefore encoded into the cursor and re-checked on the way back in:
 * replaying a cursor under a different `sortBy`/`sortOrder` is a 400, not a
 * silently duplicated or skipped page. Change the sort by restarting pagination
 * without a cursor. The rest delegate to their domain's own cursor codec, which
 * is opaque in exactly the same way.
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

/** Canonical v2 error envelope. */
export const v2ErrorResponseSchema = z.object({
  error: z
    .object({
      code: z.string().describe('Stable machine-readable error code.'),
      message: z.string().describe('Human-readable explanation of the error.'),
      details: z.unknown().optional().describe('Optional structured error details.'),
    })
    .describe('Canonical error details.'),
})

export type V2ErrorResponse = z.output<typeof v2ErrorResponseSchema>

/** `{ data: T }` */
export const v2DataResponse = <T extends z.ZodType>(dataSchema: T) =>
  z.object({ data: dataSchema.describe('Response data.') })

/** `{ data: T[], nextCursor: string | null }` — the v2 list envelope. */
export const v2CursorListResponse = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema).describe('Items in the current page.'),
    nextCursor: z
      .string()
      .nullable()
      .describe(
        'Opaque cursor for the next page: send it back as `cursor` to continue, and stop when it is null. Most v2 lists page, so null means the last page was reached. A few are full-set lists that return their whole bounded result in one response and therefore always report null; those say so in the operation description. Either way, null means there is nothing further to fetch — never construct a cursor yourself.'
      ),
  })

/**
 * Default and maximum page size for a v2 paged list.
 *
 * These are the values the majority of already-paged v2 lists shipped with
 * (`/workflows`, `/workflows/{id}/versions`, `/workflows/{id}/runs`,
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
    return base
      .optional()
      .default(fallback)
      .transform((value) => Math.min(Math.max(1, Math.trunc(value)), max))
      .describe(described)
      .meta({ type: 'integer', minimum: 1, maximum: max })
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
 * The v2 `cursor` param: the opaque token a previous page returned as
 * `nextCursor`. Empty is rejected rather than treated as "start over", so a
 * caller that accidentally forwards an empty string learns about it instead of
 * looping on page one.
 */
export function v2CursorSchema(description = 'Opaque cursor returned by the previous page.') {
  return z.string().min(1, 'cursor must be a non-empty token').optional().describe(description)
}

/**
 * The `limit` + `cursor` pair for a paged v2 list. Spread into a query object;
 * a list that returns `nextCursor` must accept both, and must actually apply
 * them.
 */
export function v2PaginationFields(options: V2LimitOptions = {}) {
  return { limit: v2LimitSchema(options), cursor: v2CursorSchema() }
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
 * are both rejected. `GET /logs` and `GET /workflows/{id}/runs` are sibling
 * reads over the same runs, so the same timestamp must work on both — sharing
 * the schema is what makes that true rather than merely intended, and it is why
 * the descriptions say "UTC ISO 8601" instead of overpromising "ISO 8601".
 */
export function v2RunWindowBoundSchema(field: 'startDate' | 'endDate') {
  const boundary = field === 'startDate' ? 'at or after' : 'at or before'
  return z
    .string()
    .datetime({ error: `${field} must be a UTC ISO 8601 timestamp, e.g. 2026-08-06T00:00:00Z` })
    .describe(
      `Only include runs started ${boundary} this UTC ISO 8601 timestamp, e.g. \`2026-08-06T00:00:00Z\`. A date without a time, or a timestamp carrying a UTC offset instead of \`Z\`, is rejected.`
    )
    .meta({ format: 'date-time' })
}

/**
 * Longest caller-supplied substring any v2 search accepts. Every one of them
 * compiles to an unindexed `ILIKE` scan, so the term itself has to be bounded
 * wherever it is accepted — including the searches that are not name searches.
 */
export const V2_SEARCH_MAX_LENGTH = 200

export const v2SearchSchema = z
  .string()
  .trim()
  .min(1, 'search cannot be empty')
  .max(V2_SEARCH_MAX_LENGTH, 'search is too long')
  .optional()
  .describe('Case-insensitive substring search on the resource name.')

export const v2SortOrderSchema = z.enum(LIST_SORT_ORDERS).describe('Sort direction.')

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

/** Canonical slash-prefixed folder path. `/` is the workspace root. */
export const v2FolderPathSchema = canonicalFolderPathSchema(parseFolderPath).describe(
  'Canonical slash-prefixed folder path. `/` is the workspace root.'
)
export type V2FolderPath = z.output<typeof v2FolderPathSchema>

/** Canonical path that identifies a real folder rather than the virtual root. */
export const v2NonRootFolderPathSchema = canonicalFolderPathSchema(
  requireNonRootFolderPath
).describe('Canonical slash-prefixed path identifying a real folder rather than the root.')

function normalizeFolderPathInput(path: string): string {
  return path.length === 0 || path.startsWith('/') ? path : `/${path}`
}

/** Input path that accepts an omitted leading slash and emits the canonical form. */
export const v2FolderPathInputSchema = z
  .string()
  .transform(normalizeFolderPathInput)
  .pipe(v2FolderPathSchema)
  .describe('Folder path. A missing leading slash is normalized before validation.')

/** Non-root input path that accepts an omitted leading slash and emits the canonical form. */
export const v2NonRootFolderPathInputSchema = z
  .string()
  .transform(normalizeFolderPathInput)
  .pipe(v2NonRootFolderPathSchema)
  .describe('Non-root folder path. A missing leading slash is normalized before validation.')

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
      .describe('Restrict results to direct children of this parent path.'),
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
    recursive: z
      .stringbool()
      .prefault('false')
      .describe('Delete nested files and folders when true.'),
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
  return {
    sortBy: z.enum(fields).default(defaults.sortBy).describe('Field used to sort the result.'),
    sortOrder: v2SortOrderSchema.default(defaults.sortOrder).describe('Sort direction.'),
  }
}
