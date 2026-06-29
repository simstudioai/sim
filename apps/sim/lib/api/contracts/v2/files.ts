import { z } from 'zod'
import { workspaceFileIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2CursorListResponse, v2DataResponse } from '@/lib/api/contracts/v2/shared'

/**
 * v2 files contracts. v2 drops the v1 `{ success, data, limits }` envelope in
 * favor of the canonical v2 shapes (`{ data }` / `{ data, nextCursor }`) and
 * adds cursor pagination to the list. The workspace is always carried as a query
 * param — including on upload — so the route can authorize before reading the
 * multipart body.
 */

/** A workspace file as exposed by the v2 surface. */
export const v2FileSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().nonnegative(),
  type: z.string(),
  key: z.string(),
  uploadedBy: z.string(),
  /** ISO-8601 timestamp. */
  uploadedAt: z.string(),
})

export type V2File = z.output<typeof v2FileSchema>

/** Acknowledgement returned by a successful archive (soft delete). */
export const v2DeleteFileResultSchema = z.object({
  id: z.string(),
  deleted: z.literal(true),
})

export type V2DeleteFileResult = z.output<typeof v2DeleteFileResultSchema>

export const v2FileParamsSchema = z.object({
  fileId: workspaceFileIdSchema,
})

export type V2FileParams = z.output<typeof v2FileParamsSchema>

/**
 * List query: workspace scope plus opaque keyset cursor pagination keyed on
 * `(uploadedAt, id)`. `limit` clamps to `[1, 1000]` (default 100) to bound the
 * response. The cursor is the base64-JSON codec shared across the v2 surface.
 */
export const v2ListFilesQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
  limit: z.coerce
    .number()
    .optional()
    .default(100)
    .transform((v) => Math.min(Math.max(1, Math.trunc(v)), 1000)),
  cursor: z.string().min(1).optional(),
})

export type V2ListFilesQuery = z.output<typeof v2ListFilesQuerySchema>

/** Upload carries the workspace as a query param so auth runs before buffering. */
export const v2UploadFileQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
})

export type V2UploadFileQuery = z.output<typeof v2UploadFileQuerySchema>

/** Download/delete both target a single file within a workspace-scoped query. */
export const v2FileWorkspaceQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
})

export type V2FileWorkspaceQuery = z.output<typeof v2FileWorkspaceQuerySchema>

export const v2ListFilesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/files',
  query: v2ListFilesQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2FileSchema),
  },
})

export const v2UploadFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files',
  query: v2UploadFileQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FileSchema),
  },
})

export const v2DownloadFileContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/files/[fileId]',
  params: v2FileParamsSchema,
  query: v2FileWorkspaceQuerySchema,
  response: {
    mode: 'binary',
  },
})

export const v2DeleteFileContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/files/[fileId]',
  params: v2FileParamsSchema,
  query: v2FileWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2DeleteFileResultSchema),
  },
})
