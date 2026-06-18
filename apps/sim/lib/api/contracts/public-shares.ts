import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const shareResourceTypeSchema = z.enum(['file', 'folder'])
export const shareAccessLevelSchema = z.enum(['view', 'edit'])
export const shareAuthTypeSchema = z.enum(['public', 'password', 'email'])

/**
 * Public-safe representation of a `public_share` row. Never carries the encrypted
 * password or the underlying storage key.
 */
export const shareRecordSchema = z.object({
  id: z.string(),
  token: z.string(),
  url: z.string(),
  isActive: z.boolean(),
  accessLevel: shareAccessLevelSchema,
  authType: shareAuthTypeSchema,
  resourceType: shareResourceTypeSchema,
  resourceId: z.string(),
})

export type ShareRecord = z.output<typeof shareRecordSchema>

const fileShareParamsSchema = z.object({
  id: workspaceIdSchema,
  fileId: z.string().min(1, 'File ID is required'),
})

export const upsertFileShareBodySchema = z.object({
  isActive: z.boolean(),
})

export type UpsertFileShareBody = z.input<typeof upsertFileShareBodySchema>

const getFileShareResponseSchema = z.object({
  share: shareRecordSchema.nullable(),
})

export type GetFileShareResponse = z.output<typeof getFileShareResponseSchema>

export const getFileShareContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/files/[fileId]/share',
  params: fileShareParamsSchema,
  response: {
    mode: 'json',
    schema: getFileShareResponseSchema,
  },
})

const upsertFileShareResponseSchema = z.object({
  share: shareRecordSchema,
})

export type UpsertFileShareResponse = z.output<typeof upsertFileShareResponseSchema>

export const upsertFileShareContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workspaces/[id]/files/[fileId]/share',
  params: fileShareParamsSchema,
  body: upsertFileShareBodySchema,
  response: {
    mode: 'json',
    schema: upsertFileShareResponseSchema,
  },
})

export const publicFileTokenParamsSchema = z.object({
  token: z.string().min(1, 'Token is required'),
})

const publicFileMetadataSchema = z.object({
  token: z.string(),
  name: z.string(),
  type: z.string(),
  size: z.number(),
  workspaceName: z.string().nullable(),
  ownerName: z.string().nullable(),
})

export type PublicFileMetadata = z.output<typeof publicFileMetadataSchema>

export const getPublicFileContract = defineRouteContract({
  method: 'GET',
  path: '/api/files/public/[token]',
  params: publicFileTokenParamsSchema,
  response: {
    mode: 'json',
    schema: publicFileMetadataSchema,
  },
})

/** Binary stream of the shared file's bytes. Authorized solely by an active token. */
export const getPublicFileContentContract = defineRouteContract({
  method: 'GET',
  path: '/api/files/public/[token]/content',
  params: publicFileTokenParamsSchema,
  response: {
    mode: 'binary',
  },
})
