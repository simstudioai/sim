// GENERATED — do not edit. Source: Sim apps/sim/lib/api/contracts/mothership-file-copy.ts
// Regenerate with `bun run generate:cli-inventory` in the worker.

import { z } from 'zod'
import { FileOperationOwner } from './file-owner'
const MAX_WORKSPACE_FILE_BULK_REQUEST_IDS = 1000

const copyIdSchema = z.string().trim().min(1).max(200)
const copyOwnerSchema = FileOperationOwner.extend({
  entityType: FileOperationOwner.shape.entityType.describe('Resource scope that owns these files.'),
  entityId: FileOperationOwner.shape.entityId.describe(
    'Identifier of the owning workspace or Project.'
  ),
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
