import { z } from 'zod'
import { privateSecretProvenanceBundleSchema } from '@/lib/api/contracts/primitives'
import { shareAuthTypeSchema } from '@/lib/api/contracts/public-shares'
import { toolJsonResponseSchema } from '@/lib/api/contracts/tools/media/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { PRIVATE_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'

export const fileManageQuerySchema = z.object({
  userId: z.string().min(1).nullable().optional(),
  workspaceId: z.string().min(1).nullable().optional(),
})

export const fileManageWriteBodySchema = z
  .object({
    operation: z.literal('write'),
    workspaceId: z.string().min(1).optional(),
    fileName: z.string().min(1).optional(),
    content: z.string().optional(),
    /**
     * An existing file object to store as-is, for content that is not text —
     * a rendered PDF, a transcoded video, an image from an earlier tool.
     */
    fileInput: z.unknown().optional(),
    contentType: z.string().optional(),
    overwrite: z.boolean().optional(),
    [PRIVATE_SECRET_PROVENANCE_FIELD]: privateSecretProvenanceBundleSchema.optional(),
  })
  .superRefine((body, context) => {
    const hasContent = body.content !== undefined
    const hasFileInput = body.fileInput !== undefined && body.fileInput !== null
    if (hasContent === hasFileInput) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message:
          'Provide exactly one of content (text to write) or fileInput (an existing file to store).',
      })
    }
    // A file object carries its own name, so fileName is the optional override
    // there but the only source of a name when writing text.
    if (hasContent && !body.fileName?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fileName'],
        message: 'fileName is required when writing text content.',
      })
    }
  })

export const fileManageAppendBodySchema = z.object({
  operation: z.literal('append'),
  workspaceId: z.string().min(1).optional(),
  fileName: z.string({ error: 'fileName is required for append operation' }).min(1),
  content: z.string({ error: 'content is required for append operation' }),
  [PRIVATE_SECRET_PROVENANCE_FIELD]: privateSecretProvenanceBundleSchema.optional(),
})

export const fileManageGetBodySchema = z
  .object({
    operation: z.literal('get'),
    workspaceId: z.string().min(1).optional(),
    fileId: z.string().min(1).optional(),
    fileInput: z.unknown().optional(),
  })
  .refine((data) => data.fileId !== undefined || data.fileInput !== undefined, {
    message: 'Either fileId or fileInput is required for get operation',
  })

export const fileManageMoveBodySchema = z.object({
  operation: z.literal('move'),
  workspaceId: z.string().min(1).optional(),
  fileId: z.string().min(1, 'fileId is required for move operation'),
  targetFolder: z.string().optional().default(''),
})

export type FileManageMoveBody = z.input<typeof fileManageMoveBodySchema>

export const fileManageSharingBodySchema = z
  .object({
    operation: z.literal('manage_sharing'),
    workspaceId: z.string().min(1).optional(),
    fileId: z.string().min(1).optional(),
    fileInput: z.unknown().optional(),
    isActive: z.boolean({ error: 'isActive is required for manage_sharing operation' }),
    authType: shareAuthTypeSchema.optional(),
    password: z.string().min(1).max(1024).optional(),
    allowedEmails: z.array(z.string().min(1)).max(200).optional(),
  })
  .refine((data) => data.fileId !== undefined || data.fileInput !== undefined, {
    message: 'Either fileId or fileInput is required for manage_sharing operation',
  })

export type FileManageSharingBody = z.input<typeof fileManageSharingBodySchema>

export const fileManageReadBodySchema = z
  .object({
    operation: z.literal('read'),
    workspaceId: z.string().min(1).optional(),
    fileId: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
    fileInput: z.unknown().optional(),
  })
  .refine((data) => data.fileId !== undefined || data.fileInput !== undefined, {
    message: 'Either fileId or fileInput is required for read operation',
  })

export const fileManageContentBodySchema = z
  .object({
    operation: z.literal('content'),
    workspaceId: z.string().min(1).optional(),
    fileId: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
    fileInput: z.unknown().optional(),
  })
  .refine((data) => data.fileId !== undefined || data.fileInput !== undefined, {
    message: 'Either fileId or fileInput is required for content operation',
  })

export const fileManageCompressBodySchema = z
  .object({
    operation: z.literal('compress'),
    workspaceId: z.string().min(1).optional(),
    fileId: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
    fileInput: z.unknown().optional(),
    archiveName: z.string().min(1).max(255).optional(),
  })
  .refine((data) => data.fileId !== undefined || data.fileInput !== undefined, {
    message: 'Either fileId or fileInput is required for compress operation',
  })

export const fileManageDecompressBodySchema = z
  .object({
    operation: z.literal('decompress'),
    workspaceId: z.string().min(1).optional(),
    fileId: z.string().min(1).optional(),
    fileInput: z.unknown().optional(),
  })
  .refine((data) => data.fileId !== undefined || data.fileInput !== undefined, {
    message: 'Either fileId or fileInput is required for decompress operation',
  })

export const fileManageBodySchema = z.union([
  fileManageWriteBodySchema,
  fileManageAppendBodySchema,
  fileManageGetBodySchema,
  fileManageMoveBodySchema,
  fileManageSharingBodySchema,
  fileManageReadBodySchema,
  fileManageContentBodySchema,
  fileManageCompressBodySchema,
  fileManageDecompressBodySchema,
])

export const fileManageContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/file/manage',
  query: fileManageQuerySchema,
  body: fileManageBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})
