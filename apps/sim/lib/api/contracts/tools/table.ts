import { z } from 'zod'
import {
  v2FolderPathInputSchema,
  v2FolderPathSchema,
  v2NonRootFolderPathInputSchema,
  v2NonRootFolderPathSchema,
} from '@/lib/api/contracts/v2/shared'
import { MAX_FOLDER_PATH_SEGMENTS } from '@/lib/folders/paths'

/**
 * Request and response shapes for the Table folder tools.
 *
 * These are plain schemas rather than `defineRouteContract` because none of the
 * six operations has an HTTP route of its own: the executor dispatches them
 * in-process through `lib/internal/table/execute-tool.ts`, and a contract
 * declaring a `method` and `path` nothing serves would be fiction. Reusing the
 * public v2 folder contracts instead was considered and rejected — those are
 * shaped by HTTP (a `recursive` flag coerced from a query string, cursor
 * envelopes around every list) and tying the model-facing surface to a
 * published API would make either side's revision silently change the other.
 *
 * The path schemas ARE shared with v2, deliberately: how a folder is spelled is
 * a domain fact, not a transport one, and a second spelling is exactly the drift
 * the shared parser exists to prevent.
 *
 * No schema here takes a `workspaceId`. The executor mints a delegated principal
 * bound to the run's workspace and every operation reads it from there, so
 * accepting one on the input would declare a field the server ignores.
 */

const tableIdSchema = z.string().min(1, 'tableId is required').describe('Unique table identifier.')

const folderTimestampsShape = {
  createdAt: z.string().describe('ISO 8601 timestamp when the folder was created.'),
  updatedAt: z.string().describe('ISO 8601 timestamp when the folder was last updated.'),
}

const tableFolderSchema = z.object({
  name: z.string().describe('Folder name, decoded.'),
  path: v2NonRootFolderPathSchema.describe('Canonical folder path, which identifies the folder.'),
  parentPath: v2FolderPathSchema.describe(
    'Canonical path of the parent; `/` is the workspace root.'
  ),
  ...folderTimestampsShape,
})

const listedTableFolderSchema = tableFolderSchema.extend({
  depth: z
    .number()
    .int()
    .describe('How far below the listed folder this one sits. 1 is a direct child.'),
})

const folderCascadeCountsSchema = z.object({
  folders: z.number().int().describe('Folders affected, including the one addressed.'),
  tables: z.number().int().describe('Tables affected inside those folders.'),
})

const tableFolderDepthSchema = z
  .number()
  .int()
  .min(1, 'depth must be at least 1')
  .max(MAX_FOLDER_PATH_SEGMENTS, `depth cannot exceed ${MAX_FOLDER_PATH_SEGMENTS}`)

/**
 * The listing is capped rather than unbounded, and a listing cut short reports
 * `truncated` instead of quietly looking complete.
 */
export const DEFAULT_TABLE_FOLDER_LIST_LIMIT = 200
export const MAX_TABLE_FOLDER_LIST_LIMIT = 1000

export const tableListFoldersSchemas = {
  body: z.object({
    path: v2FolderPathInputSchema.optional(),
    recursive: z.boolean().optional(),
    depth: tableFolderDepthSchema.optional(),
    search: z.string().min(1, 'search cannot be empty').max(200, 'search is too long').optional(),
    limit: z
      .number()
      .int()
      .min(1, 'limit must be at least 1')
      .max(MAX_TABLE_FOLDER_LIST_LIMIT, `limit cannot exceed ${MAX_TABLE_FOLDER_LIST_LIMIT}`)
      .optional(),
  }),
} as const
export type ListTableFoldersToolBody = z.output<typeof tableListFoldersSchemas.body>

export const tableListFoldersResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    path: v2FolderPathSchema.describe('The folder that was listed.'),
    folders: z.array(listedTableFolderSchema),
    truncated: z
      .boolean()
      .describe('True when the limit cut the listing short, so more folders exist.'),
  }),
})

export const tableCreateFolderSchemas = {
  body: z.object({
    path: v2NonRootFolderPathInputSchema,
  }),
} as const
export type CreateTableFolderToolBody = z.output<typeof tableCreateFolderSchemas.body>

export const tableCreateFolderResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({ folder: tableFolderSchema }),
})

export const tableUpdateFolderSchemas = {
  body: z
    .object({
      path: v2NonRootFolderPathInputSchema,
      destinationPath: v2NonRootFolderPathInputSchema,
    })
    .superRefine((body, ctx) => {
      if (body.path === body.destinationPath) {
        ctx.addIssue({
          code: 'custom',
          path: ['destinationPath'],
          message: 'destinationPath must differ from path',
        })
      }
    }),
} as const
export type UpdateTableFolderToolBody = z.output<typeof tableUpdateFolderSchemas.body>

export const tableUpdateFolderResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    folder: tableFolderSchema,
    previousPath: v2NonRootFolderPathSchema.describe('The path the folder had before the move.'),
  }),
})

export const tableDeleteFolderSchemas = {
  body: z.object({
    path: v2NonRootFolderPathInputSchema,
    /**
     * A real boolean, not the `z.stringbool()` the v2 query-string contract
     * needs. Nothing here travels through a URL, and this flag is the guard
     * between deleting one empty folder and deleting a subtree — the last place
     * to add a coercion that could read an unexpected spelling as `false`.
     */
    recursive: z.boolean().optional(),
  }),
} as const
export type DeleteTableFolderToolBody = z.output<typeof tableDeleteFolderSchemas.body>

export const tableDeleteFolderResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    path: v2NonRootFolderPathSchema.describe('The folder that was deleted.'),
    deleted: z.literal(true),
    deletedItems: folderCascadeCountsSchema,
  }),
})

export const tableRestoreFolderSchemas = {
  body: z.object({
    /**
     * A deleted folder is addressed by the path it held when it was deleted.
     * Restore may land it elsewhere — a folder whose parent is still archived is
     * re-rooted, and a name an active sibling has taken meanwhile is
     * deduplicated — so the response reports where it actually went.
     */
    path: v2NonRootFolderPathInputSchema,
  }),
} as const
export type RestoreTableFolderToolBody = z.output<typeof tableRestoreFolderSchemas.body>

export const tableRestoreFolderResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    folder: tableFolderSchema,
    requestedPath: v2NonRootFolderPathSchema.describe('The path the folder was addressed by.'),
    restoredItems: folderCascadeCountsSchema,
  }),
})

export const tableMoveSchemas = {
  body: z.object({
    tableId: tableIdSchema,
    /** Omitted moves the table to the workspace root; `/` says the same thing explicitly. */
    folderPath: v2FolderPathInputSchema.optional(),
  }),
} as const
export type MoveTableToolBody = z.output<typeof tableMoveSchemas.body>

export const tableMoveResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    tableId: tableIdSchema.describe('The table that was moved.'),
    name: z.string().describe('Name of the moved table.'),
    folderPath: v2FolderPathSchema.describe('The folder the table now lives in.'),
  }),
})
