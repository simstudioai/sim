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
 * Every one of these is pushed into SQL, except on `GET /skills` (which merges
 * the static builtin registry into the DB rows, then re-filters and re-sorts the
 * merged array) and `GET /files/folders` (which applies `parentPath` and `search`
 * in JS; its sort is pushed into SQL like every other folder list). Both read a
 * full result set to produce a page; neither is a pattern to copy.
 *
 * ## Which lists are paged
 *
 * The authoritative split is pinned in `v2/__tests__/list-pagination.test.ts`,
 * not restated here. A full-set list returns `nextCursor: null` on every
 * response — its OpenAPI description says so explicitly, so a caller never
 * writes a pagination loop that can only ever run once.
 * Adding `limit`/`cursor` to a full-set list is additive,
 * but making a `limit` *default* would silently truncate callers that rely on
 * the full set today, so a default page size cannot be introduced without a
 * version bump.
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
 * The v2 `search` term: a case-insensitive substring match on the resource's
 * natural name field. Bounded at 200 characters — a longer term cannot match
 * any of the name columns it is aimed at, and every one of these matches is an
 * unindexed scan.
 */
export const v2SearchSchema = z
  .string()
  .trim()
  .min(1, 'search cannot be empty')
  .max(200, 'search is too long')
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
