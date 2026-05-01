import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const workspaceFileScopeSchema = z.enum(['active', 'archived', 'all'])

export const workspaceFilesParamsSchema = z.object({
  id: z.string({ error: 'Workspace ID is required' }).min(1, 'Workspace ID is required'),
})

export const workspaceFileParamsSchema = workspaceFilesParamsSchema.extend({
  fileId: z.string({ error: 'File ID is required' }).min(1, 'File ID is required'),
})

export const listWorkspaceFilesQuerySchema = z.object({
  scope: workspaceFileScopeSchema.default('active'),
})

export const renameWorkspaceFileBodySchema = z.object({
  name: z
    .string({ error: 'Name is required' })
    .refine((name) => name.trim().length > 0, { message: 'Name is required' }),
})

export const updateWorkspaceFileContentBodySchema = z.object({
  content: z.string(),
  encoding: z.enum(['base64', 'utf-8']).optional(),
})

export const workspaceFileRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  key: z.string(),
  path: z.string(),
  url: z.string().optional(),
  size: z.number(),
  type: z.string(),
  uploadedBy: z.string(),
  deletedAt: z.coerce.date().nullable().optional(),
  uploadedAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  storageContext: z.enum(['workspace', 'mothership']).optional(),
})

const workspaceFileSuccessSchema = z.object({
  success: z.boolean(),
})

export const listWorkspaceFilesContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/files',
  params: workspaceFilesParamsSchema,
  query: listWorkspaceFilesQuerySchema,
  response: {
    mode: 'json',
    schema: workspaceFileSuccessSchema.extend({
      files: z.array(workspaceFileRecordSchema),
    }),
  },
})

export const renameWorkspaceFileContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workspaces/[id]/files/[fileId]',
  params: workspaceFileParamsSchema,
  body: renameWorkspaceFileBodySchema,
  response: {
    mode: 'json',
    schema: workspaceFileSuccessSchema.extend({
      file: workspaceFileRecordSchema,
    }),
  },
})

export const deleteWorkspaceFileContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/files/[fileId]',
  params: workspaceFileParamsSchema,
  response: {
    mode: 'json',
    schema: workspaceFileSuccessSchema,
  },
})

export const restoreWorkspaceFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/files/[fileId]/restore',
  params: workspaceFileParamsSchema,
  response: {
    mode: 'json',
    schema: workspaceFileSuccessSchema,
  },
})

export const updateWorkspaceFileContentContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workspaces/[id]/files/[fileId]/content',
  params: workspaceFileParamsSchema,
  body: updateWorkspaceFileContentBodySchema,
  response: {
    mode: 'json',
    schema: workspaceFileSuccessSchema.extend({
      file: workspaceFileRecordSchema,
    }),
  },
})

const documentStyleSummarySchema = z
  .object({
    format: z.enum(['docx', 'pptx']),
    theme: z
      .object({
        name: z.string(),
        colors: z.record(z.string(), z.string()),
        fonts: z.object({ major: z.string(), minor: z.string() }),
      })
      .passthrough(),
    styles: z.array(z.object({}).passthrough()).optional(),
  })
  .passthrough()

export const workspaceFileStyleContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/files/[fileId]/style',
  params: workspaceFileParamsSchema,
  response: {
    mode: 'json',
    schema: documentStyleSummarySchema,
  },
})

const compiledCheckResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string(), errorName: z.string() }),
])

export const workspaceFileCompiledCheckContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/files/[fileId]/compiled-check',
  params: workspaceFileParamsSchema,
  response: {
    mode: 'json',
    schema: compiledCheckResponseSchema,
  },
})
