import { z } from 'zod'
import {
  fileCopyDestinationSchema,
  fileCopyInputSchema,
} from '@/lib/api/contracts/mothership-file-copy'
import { noInputSchema, nonEmptyIdSchema } from '@/lib/api/contracts/primitives'
import { projectFileFolderRecordSchema } from '@/lib/api/contracts/project-file-folders'
import { projectFileRecordSchema } from '@/lib/api/contracts/project-files'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const copyFileItemsBodySchema = fileCopyInputSchema
export type CopyFileItemsBody = z.input<typeof copyFileItemsBodySchema>

export const copiedFileSchema = projectFileRecordSchema
  .omit({ key: true, path: true, url: true, share: true })
  .extend({
    id: projectFileRecordSchema.shape.id.describe('Identifier of the new file.'),
    name: projectFileRecordSchema.shape.name.describe(
      'Name of the copied file, including its extension.'
    ),
    size: projectFileRecordSchema.shape.size.describe('Current content size in bytes.'),
    type: projectFileRecordSchema.shape.type.describe('MIME type of the copied file.'),
    width: projectFileRecordSchema.shape.width.describe(
      'Known image width in pixels, when available.'
    ),
    height: projectFileRecordSchema.shape.height.describe(
      'Known image height in pixels, when available.'
    ),
    uploadedBy: projectFileRecordSchema.shape.uploadedBy.describe(
      'User who performed the copy, when available.'
    ),
    originalCreatorUserId: projectFileRecordSchema.shape.originalCreatorUserId.describe(
      'Original creator identifier retained after account deletion.'
    ),
    folderId: projectFileRecordSchema.shape.folderId.describe(
      'Containing folder identifier, or null at the owner root.'
    ),
    folderPath: projectFileRecordSchema.shape.folderPath.describe(
      'Containing folder path, or null at the owner root.'
    ),
    deletedAt: z.iso.datetime().nullable().describe('Archive time, or null for an active file.'),
    uploadedAt: z.iso.datetime().describe('Time the new file was created.'),
    updatedAt: z.iso.datetime().describe('Time the file metadata last changed.'),
    contentUpdatedAt: z.iso
      .datetime()
      .nullable()
      .describe('Time the current file content was written.'),
    owner: fileCopyDestinationSchema.shape.owner.describe(
      'Canonical destination owner of the copied file.'
    ),
    revision: nonEmptyIdSchema.describe('Current content revision for subsequent edits.'),
  })
export type CopiedFile = z.output<typeof copiedFileSchema>

export const copiedFileFolderSchema = projectFileFolderRecordSchema.extend({
  id: projectFileFolderRecordSchema.shape.id.describe('Identifier of the new folder.'),
  userId: projectFileFolderRecordSchema.shape.userId.describe(
    'User who performed the copy, when available.'
  ),
  originalCreatorUserId: projectFileFolderRecordSchema.shape.originalCreatorUserId.describe(
    'Original creator identifier retained after account deletion.'
  ),
  name: projectFileFolderRecordSchema.shape.name.describe('Name of the copied folder.'),
  parentId: projectFileFolderRecordSchema.shape.parentId.describe(
    'Parent folder identifier, or null at the owner root.'
  ),
  path: projectFileFolderRecordSchema.shape.path.describe(
    'Path of the copied folder within its owner.'
  ),
  sortOrder: projectFileFolderRecordSchema.shape.sortOrder.describe(
    'Display ordering value within the parent folder.'
  ),
  deletedAt: z.iso.datetime().nullable().describe('Archive time, or null for an active folder.'),
  createdAt: z.iso.datetime().describe('Time the new folder was created.'),
  updatedAt: z.iso.datetime().describe('Time the folder metadata last changed.'),
  owner: fileCopyDestinationSchema.shape.owner.describe(
    'Canonical destination owner of the copied folder.'
  ),
})
export type CopiedFileFolder = z.output<typeof copiedFileFolderSchema>

export const copyFileItemsResponseSchema = z.object({
  files: z.array(copiedFileSchema).describe('Created files with new identities.'),
  folders: z.array(copiedFileFolderSchema).describe('Created folders in their new hierarchy.'),
})
export type CopyFileItemsResponse = z.output<typeof copyFileItemsResponseSchema>

export const copyFileItemsContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/copy',
  query: noInputSchema,
  body: copyFileItemsBodySchema,
  response: { mode: 'json', schema: copyFileItemsResponseSchema, status: 201 },
})
