import { z } from 'zod'
import { dashboardContentSchema, dashboardNameSchema } from '@/lib/api/contracts/dashboards'
import {
  normalizeFolderPathInput,
  v2FolderPathSchema,
  v2NonRootFolderPathSchema,
} from '@/lib/api/contracts/v2/shared'

/**
 * The files folder-path inputs, rebuilt without their registry ids: an agent tool schema
 * must inline every property, and a registered id becomes an unsupported `$ref`.
 */
const folderPath = z
  .string()
  .transform(normalizeFolderPathInput)
  .pipe(v2FolderPathSchema)
  .describe('Folder path, as for files; the leading / is optional and / is the root.')
const folderPathNotRoot = z
  .string()
  .transform(normalizeFolderPathInput)
  .pipe(v2NonRootFolderPathSchema)
  .describe('Folder path as shown in the app; the leading / is optional.')

const scope = z.object({ workspaceId: z.string().min(1).max(100).optional() })
const target = scope.extend({ dashboardId: z.string().min(1).max(100) })
/** Mirrors the `files` commands: folders are addressed by path (leading `/` optional), and `/` is the root. */
export const mothershipDashboardsInputSchema = z.discriminatedUnion('action', [
  scope
    .extend({
      action: z.literal('list'),
      search: z.string().max(255).optional(),
      folder: folderPath.optional(),
    })
    .strict(),
  target.extend({ action: z.literal('get') }).strict(),
  scope
    .extend({
      action: z.literal('create'),
      name: dashboardNameSchema,
      content: dashboardContentSchema,
      folder: folderPath.optional(),
    })
    .strict(),
  target
    .extend({
      action: z.literal('set-content'),
      content: dashboardContentSchema,
      expectedRevision: z.string().min(1).max(256),
    })
    .strict(),
  target.extend({ action: z.literal('rename'), name: dashboardNameSchema }).strict(),
  target.extend({ action: z.literal('move'), to: folderPath }).strict(),
  target.extend({ action: z.literal('delete') }).strict(),
])
export const mothershipDashboardFoldersInputSchema = z.discriminatedUnion('action', [
  scope.extend({ action: z.literal('list') }).strict(),
  scope.extend({ action: z.literal('create'), path: folderPathNotRoot }).strict(),
  scope
    .extend({
      action: z.literal('move'),
      path: folderPathNotRoot,
      destination: folderPathNotRoot,
    })
    .strict(),
  scope
    .extend({
      action: z.literal('delete'),
      path: folderPathNotRoot,
      recursive: z.boolean().optional(),
    })
    .strict(),
])
