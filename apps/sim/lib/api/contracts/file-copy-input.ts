import { z } from 'zod'
import { MAX_WORKSPACE_FILE_BULK_REQUEST_IDS } from '@/lib/workspace-files/limits'

const copyIdSchema = z.string().trim().min(1).max(200)
const copyOwnerSchema = z.strictObject({
  entityType: z.enum(['workspace', 'project']).describe('Resource scope that owns these files.'),
  entityId: z.string().min(1).max(200).describe('Identifier of the owning workspace or Project.'),
})
const copyIdsSchema = z
  .array(copyIdSchema)
  .max(MAX_WORKSPACE_FILE_BULK_REQUEST_IDS, 'Too many selected file items')
  .refine((ids) => new Set(ids).size === ids.length, 'Selected identifiers must be unique')
  .default([])

export const fileCopySourceSchema = z
  .strictObject({
    owner: copyOwnerSchema.describe('Owner from which to read the selected files and folders.'),
    fileIds: copyIdsSchema.describe('Identifiers of individual files to copy.'),
    folderIds: copyIdsSchema.describe(
      'Identifiers of folders to copy with their active descendants and files.'
    ),
  })
  .refine((source) => source.fileIds.length + source.folderIds.length > 0, {
    message: 'Select at least one file or folder to copy',
  })
export type FileCopySource = z.output<typeof fileCopySourceSchema>

export const fileCopyDestinationSchema = z.strictObject({
  owner: copyOwnerSchema.describe('Owner in which to create the copied files and folders.'),
  folderId: copyIdSchema
    .nullable()
    .default(null)
    .describe('Existing destination folder identifier. Omit or use null for the owner root.'),
})
export type FileCopyDestination = z.output<typeof fileCopyDestinationSchema>

export const fileCopyInputSchema = z.strictObject({
  source: fileCopySourceSchema.describe('Selection to read under the source owner.'),
  destination: fileCopyDestinationSchema.describe('Destination requiring file write access.'),
})
export type FileCopyInput = z.output<typeof fileCopyInputSchema>
