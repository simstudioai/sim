import { z } from 'zod'
import {
  folderCascadeCountsSchema,
  folderResourceTypeSchema,
  folderScopeSchema,
  servedFolderResourceTypeSchema,
} from '@/lib/api/contracts/folders'
import { nonEmptyIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2SearchSchema,
  v2SortFields,
} from '@/lib/api/contracts/v2/shared'

/**
 * v2 folder contracts.
 *
 * One folder engine serves several resource trees (`workflow`, `knowledge_base`,
 * `table`), discriminated by `resourceType`. The internal surface defaults that
 * field to `workflow` so an old client that never sends it keeps working across
 * a deploy; the public surface has no such legacy, and defaulting it would let a
 * caller silently file a knowledge-base folder into the workflow tree where the
 * Knowledge page can never see it again. So v2 **requires** it on every
 * operation, reusing the served enum with its default stripped.
 *
 * `duplicate`, `restore`, and `reorder` are not part of the public surface.
 */

/** The served resource types, required rather than defaulted. */
export const v2FolderResourceTypeSchema = servedFolderResourceTypeSchema.unwrap()
export type V2FolderResourceType = z.output<typeof v2FolderResourceTypeSchema>

/**
 * Public folder projection. `userId` (the creator) and `workspaceId` (already
 * known to the caller, who supplied it) are internal columns and not exposed.
 */
export const v2FolderSchema = z.object({
  id: z.string(),
  resourceType: folderResourceTypeSchema,
  name: z.string(),
  parentId: z.string().nullable(),
  /** Workflow folders only; always `false` for the other resource types. */
  locked: z.boolean(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Set when the folder is archived (in Recently Deleted) rather than live. */
  deletedAt: z.string().nullable(),
})
export type V2Folder = z.output<typeof v2FolderSchema>

/** `{ folder }` payload for single-folder reads and mutations. */
export const v2FolderDataSchema = z.object({ folder: v2FolderSchema })
export type V2FolderData = z.output<typeof v2FolderDataSchema>

/**
 * Delete acknowledgement. `deletedItems` reports what the cascade archived
 * alongside the folder; only the key matching `resourceType` is populated.
 */
export const v2FolderDeleteDataSchema = z.object({
  id: z.string(),
  deleted: z.literal(true),
  deletedItems: folderCascadeCountsSchema.optional(),
})
export type V2FolderDeleteData = z.output<typeof v2FolderDeleteDataSchema>

export const v2FolderParamsSchema = z.object({
  id: nonEmptyIdSchema,
})
export type V2FolderParams = z.output<typeof v2FolderParamsSchema>

/** Query for the id-keyed reads and the delete. */
export const v2FolderScopedQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
  resourceType: v2FolderResourceTypeSchema,
})
export type V2FolderScopedQuery = z.output<typeof v2FolderScopedQuerySchema>

/**
 * Sortable folder fields. `position` is the tree's manual arrangement (the
 * `sort_order` column), kept as the default so a bare list still comes back in
 * the order the workspace arranged it.
 */
export const v2FolderSortFields = ['position', 'name', 'createdAt', 'updatedAt'] as const

export type V2FolderSortBy = (typeof v2FolderSortFields)[number]

/**
 * List query. `search` narrows to folders whose name matches; the result stays
 * a flat list either way, so a matching folder is returned without its
 * ancestors — reconstruct a tree from `parentId` only on an unsearched list.
 */
export const v2ListFoldersQuerySchema = v2FolderScopedQuerySchema.extend({
  /** `active` (default) lists live folders; `archived` lists Recently Deleted. */
  scope: folderScopeSchema.default('active'),
  search: v2SearchSchema,
  ...v2SortFields(v2FolderSortFields, { sortBy: 'position', sortOrder: 'asc' }),
})
export type V2ListFoldersQuery = z.output<typeof v2ListFoldersQuerySchema>

export const v2CreateFolderBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    resourceType: v2FolderResourceTypeSchema,
    name: z.string().trim().min(1, 'name is required').max(255, 'name is too long'),
    /** Explicit `null` creates the folder at the workspace root. */
    parentId: z.string().min(1, 'parentId cannot be empty').nullable().optional(),
    sortOrder: z.number().int('sortOrder must be an integer').min(0).optional(),
  })
  .strict()
export type V2CreateFolderBody = z.input<typeof v2CreateFolderBodySchema>

/** Update body. Omitted fields keep their stored values. */
export const v2UpdateFolderBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    resourceType: v2FolderResourceTypeSchema,
    name: z.string().trim().min(1, 'name cannot be empty').max(255, 'name is too long').optional(),
    /** Workflow folders only, and changing it requires workspace `admin`. */
    locked: z.boolean().optional(),
    parentId: z.string().min(1, 'parentId cannot be empty').nullable().optional(),
    sortOrder: z.number().int('sortOrder must be an integer').min(0).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (
      body.name === undefined &&
      body.locked === undefined &&
      body.parentId === undefined &&
      body.sortOrder === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'At least one of name, locked, parentId, or sortOrder is required',
      })
    }
  })
export type V2UpdateFolderBody = z.input<typeof v2UpdateFolderBodySchema>

/**
 * Folder list. A workspace's folder tree for one resource type is small and
 * bounded, so the full set is returned as a single page (`nextCursor` is always
 * `null`); the canonical cursor envelope keeps the v2 list surface uniform.
 */
export const v2ListFoldersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/folders',
  query: v2ListFoldersQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2FolderSchema),
  },
})

export const v2CreateFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/folders',
  body: v2CreateFolderBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FolderDataSchema),
  },
})

export const v2GetFolderContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/folders/[id]',
  params: v2FolderParamsSchema,
  query: v2FolderScopedQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FolderDataSchema),
  },
})

export const v2UpdateFolderContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/folders/[id]',
  params: v2FolderParamsSchema,
  body: v2UpdateFolderBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FolderDataSchema),
  },
})

export const v2DeleteFolderContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/folders/[id]',
  params: v2FolderParamsSchema,
  query: v2FolderScopedQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FolderDeleteDataSchema),
  },
})
