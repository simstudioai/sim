import { z } from 'zod'
import { successResponseSchema } from '@/lib/api/contracts/knowledge/shared'
import {
  v2FolderPathInputSchema,
  v2FolderPathSchema,
  v2NonRootFolderPathInputSchema,
  v2NonRootFolderPathSchema,
} from '@/lib/api/contracts/v2/shared'
import { MAX_FOLDER_PATH_SEGMENTS } from '@/lib/folders/paths'

/**
 * Knowledge folder tools have no HTTP route of their own: they run in-process
 * through `executeKnowledgeTool`. So these are bare
 * {@link InternalOperationSchemas} rather than `defineRouteContract` calls,
 * which would declare a `method` and `path` nothing serves.
 */

const knowledgeFolderDepthSchema = z
  .number()
  .int()
  .min(1, 'depth must be at least 1')
  .max(MAX_FOLDER_PATH_SEGMENTS, `depth cannot exceed ${MAX_FOLDER_PATH_SEGMENTS}`)

/**
 * The listing is capped rather than unbounded: it carries knowledge bases as
 * well as folders, and a cut listing reports `truncated` instead of quietly
 * looking complete.
 */
export const DEFAULT_KNOWLEDGE_LIST_LIMIT = 200
export const MAX_KNOWLEDGE_LIST_LIMIT = 1000

export const knowledgeListFoldersBodySchema = z
  .object({
    path: v2FolderPathInputSchema.optional(),
    recursive: z.boolean().optional(),
    depth: knowledgeFolderDepthSchema.optional(),
    /*
     * Trimmed before the emptiness check: the listing reads a blank search as no
     * search at all and returns every entry, so "   " would quietly become an
     * unfiltered listing rather than the empty match the caller asked for.
     */
    search: z
      .string()
      .max(200)
      .transform((value) => value.trim())
      .pipe(z.string().min(1, 'search cannot be empty'))
      .optional(),
    limit: z
      .number()
      .int()
      .min(1, 'limit must be at least 1')
      .max(MAX_KNOWLEDGE_LIST_LIMIT, `limit cannot exceed ${MAX_KNOWLEDGE_LIST_LIMIT}`)
      .optional(),
  })
  /*
   * A listing that is not recursive is exactly its direct children, so a depth
   * alongside it is silently discarded. Rejecting the pair is what tells a model
   * that, instead of returning a shallower answer than it asked for.
   */
  .refine((body) => body.depth === undefined || body.recursive === true, {
    message: 'depth only applies when recursive is true',
    path: ['depth'],
  })

export const knowledgeListFoldersSchemas = { body: knowledgeListFoldersBodySchema } as const

/**
 * Discriminated on `kind`, so a consumer narrows before reaching for the fields
 * only one side has: a folder has a path of its own, a knowledge base has the
 * path of the folder holding it.
 */
const knowledgeDirectoryEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('folder'),
    id: z.string(),
    name: z.string(),
    path: v2FolderPathSchema,
    parentPath: v2FolderPathSchema,
    depth: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  z.object({
    kind: z.literal('knowledge_base'),
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    folderPath: v2FolderPathSchema,
    depth: z.number().int(),
    docCount: z.number().int(),
    tokenCount: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
])

export const knowledgeListFoldersResponseSchema = successResponseSchema(
  z.object({
    path: v2FolderPathSchema,
    entries: z.array(knowledgeDirectoryEntrySchema),
    truncated: z.boolean(),
  })
)

const knowledgeFolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  /* A created, moved, or deleted folder is never the root; only a parent can be. */
  path: v2NonRootFolderPathSchema,
  parentPath: v2FolderPathSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const knowledgeCreateFolderBodySchema = z.object({
  path: v2NonRootFolderPathInputSchema,
})

export const knowledgeCreateFolderSchemas = { body: knowledgeCreateFolderBodySchema } as const

export const knowledgeCreateFolderResponseSchema = successResponseSchema(
  z.object({ folder: knowledgeFolderSchema })
)

export const knowledgeUpdateFolderBodySchema = z.object({
  path: v2NonRootFolderPathInputSchema,
  destinationPath: v2NonRootFolderPathInputSchema,
})

export const knowledgeUpdateFolderSchemas = { body: knowledgeUpdateFolderBodySchema } as const

export const knowledgeUpdateFolderResponseSchema = successResponseSchema(
  z.object({ folder: knowledgeFolderSchema, previousPath: v2FolderPathSchema })
)

export const knowledgeDeleteFolderBodySchema = z.object({
  path: v2NonRootFolderPathInputSchema,
  recursive: z.boolean().optional(),
})

export const knowledgeDeleteFolderSchemas = { body: knowledgeDeleteFolderBodySchema } as const

export const knowledgeDeleteFolderResponseSchema = successResponseSchema(
  z.object({
    path: v2NonRootFolderPathSchema,
    deleted: z.literal(true),
    deletedItems: z.object({
      folders: z.number().int(),
      knowledgeBases: z.number().int(),
    }),
  })
)
