import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { FolderPathError, parseFolderPath, requireNonRootFolderPath } from '@/lib/folders/paths'

/**
 * Shared building blocks for the v2 API contract surface.
 *
 * v2 standardizes on a single response family across every endpoint:
 * - single resource:   `{ data: T }`
 * - list:              `{ data: T[], nextCursor: string | null }`
 * - error:             `{ error: { code, message, details? } }`
 *
 * Every list uses the opaque-cursor envelope (Stripe/Slack-style): `limit` +
 * `cursor` in, `{ data, nextCursor }` out. Cursors are opaque so the underlying
 * scheme (keyset / offset / full-set) can change without a contract change.
 * Total counts are not returned on lists — they're available on the parent
 * resource where relevant (e.g. `rowCount` on a table, `docCount` on a KB).
 *
 * Rate-limit state is carried in `X-RateLimit-*` response headers (not the
 * body). Usage limits are available from the dedicated usage endpoint rather
 * than being inlined into every response.
 *
 * ## Search, filtering, and sorting
 *
 * One convention, applied by every v2 list. It is deliberately the narrow
 * scalar-param form the app's own list endpoints already speak — not a third
 * dialect alongside the Logs filter set and the Tables predicate grammar.
 * A list that needs a real expression tree (Tables) keeps its own `POST /query`.
 *
 * - **`search`** ({@link v2SearchSchema}) — a case-insensitive substring match
 *   against the resource's *single* natural name field, and nothing else:
 *   `name` for files/folders/workflows/tables/knowledge bases/MCP servers/
 *   skills, `title` for custom tools, `displayName` for credentials. It never
 *   matches ids, descriptions, or content. `%` and `_` in the term are matched
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
 * Every one of these is pushed into SQL. No v2 list fetches a full result set
 * to filter or sort it in memory.
 *
 * ## Sort and the opaque cursor
 *
 * On the lists that paginate ({@link v2CursorListResponse} with a non-null
 * `nextCursor` — files and workflows), the cursor is a keyset over the *active*
 * sort, so its keys change when the sort does. The sort is therefore encoded
 * into the cursor and re-checked on the way back in: replaying a cursor under a
 * different `sortBy`/`sortOrder` is a 400, not a silently duplicated or skipped
 * page. Change the sort by restarting pagination without a cursor.
 */

/** Canonical v2 error envelope. */
export const v2ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
})

/** `{ data: T }` */
export const v2DataResponse = <T extends z.ZodType>(dataSchema: T) => z.object({ data: dataSchema })

/** `{ data: T[], nextCursor: string | null }` — the v2 list envelope. */
export const v2CursorListResponse = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    nextCursor: z.string().nullable(),
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

export const v2SortOrderSchema = z.enum(['asc', 'desc'])

export type V2SortOrder = z.output<typeof v2SortOrderSchema>

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
export const v2FolderPathSchema = canonicalFolderPathSchema(parseFolderPath)
export type V2FolderPath = z.output<typeof v2FolderPathSchema>

/** Canonical path that identifies a real folder rather than the virtual root. */
export const v2NonRootFolderPathSchema = canonicalFolderPathSchema(requireNonRootFolderPath)

function normalizeFolderPathInput(path: string): string {
  return path.length === 0 || path.startsWith('/') ? path : `/${path}`
}

/** Input path that accepts an omitted leading slash and emits the canonical form. */
export const v2FolderPathInputSchema = z
  .string()
  .transform(normalizeFolderPathInput)
  .pipe(v2FolderPathSchema)

/** Non-root input path that accepts an omitted leading slash and emits the canonical form. */
export const v2NonRootFolderPathInputSchema = z
  .string()
  .transform(normalizeFolderPathInput)
  .pipe(v2NonRootFolderPathSchema)

export const v2FolderSchema = z.object({
  name: z.string(),
  path: v2NonRootFolderPathSchema,
  parentPath: v2FolderPathSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type V2Folder = z.output<typeof v2FolderSchema>

export const v2FolderSortFields = ['name', 'createdAt', 'updatedAt'] as const

export const v2ListFoldersQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    parentPath: v2FolderPathInputSchema.optional(),
    search: v2SearchSchema,
    ...v2SortFields(v2FolderSortFields, { sortBy: 'name', sortOrder: 'asc' }),
  })
  .strict()

export const v2CreateFolderBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    path: v2NonRootFolderPathInputSchema,
  })
  .strict()

export const v2RelocateFolderBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    path: v2NonRootFolderPathInputSchema,
    destinationPath: v2NonRootFolderPathInputSchema,
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
    workspaceId: workspaceIdSchema,
    path: v2NonRootFolderPathInputSchema,
    recursive: z.stringbool().optional().default(false),
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
    sortBy: z.enum(fields).default(defaults.sortBy),
    sortOrder: v2SortOrderSchema.default(defaults.sortOrder),
  }
}
