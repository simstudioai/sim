import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import { folderSchema } from '@/lib/api/contracts/folders'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'

export const dashboardParamsSchema = z.object({
  id: workspaceIdSchema,
  dashboardId: z.string().min(1).max(100),
})
const workspaceParams = dashboardParamsSchema.pick({ id: true })
export const dashboardNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(220)
  .regex(/^[^/\\]+$/, 'Name cannot contain slashes')
export const dashboardContentSchema = z
  .string()
  .min(1)
  .max(128 * 1024)
export const dashboardRecordSchema = z.object({
  id: z.string(),
  type: z.literal('dashboard'),
  name: z.string(),
  folderId: z.string().nullable(),
  path: z.string(),
  updatedAt: z.string(),
  revision: z.string().nullable(),
})
const recordResponse = z.object({ dashboard: dashboardRecordSchema })
export const createDashboardBodySchema = z
  .object({
    name: dashboardNameSchema,
    content: dashboardContentSchema,
    folderId: z.string().min(1).nullable().optional(),
  })
  .strict()
export const updateDashboardBodySchema = z
  .object({ content: dashboardContentSchema, expectedRevision: z.string().min(1).max(256) })
  .strict()
export const moveDashboardBodySchema = z
  .object({
    name: dashboardNameSchema.optional(),
    folderId: z.string().min(1).nullable().optional(),
  })
  .strict()
export const listDashboardsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/dashboards',
  params: workspaceParams,
  query: z.object({ search: z.string().max(255).optional() }),
  response: {
    mode: 'json',
    schema: z.object({ dashboards: z.array(dashboardRecordSchema), truncated: z.boolean() }),
  },
})
export const createDashboardContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/dashboards',
  params: workspaceParams,
  body: createDashboardBodySchema,
  response: { mode: 'json', schema: recordResponse },
})
export const readDashboardContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/dashboards/[dashboardId]',
  params: dashboardParamsSchema,
  response: { mode: 'json', schema: recordResponse.extend({ content: z.string() }) },
})
export const updateDashboardContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workspaces/[id]/dashboards/[dashboardId]',
  params: dashboardParamsSchema,
  body: updateDashboardBodySchema,
  response: { mode: 'json', schema: recordResponse },
})
export const moveDashboardContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workspaces/[id]/dashboards/[dashboardId]',
  params: dashboardParamsSchema,
  body: moveDashboardBodySchema,
  response: { mode: 'json', schema: recordResponse },
})
const deletedResponse = z.object({ deleted: z.literal(true), id: z.string() })
export const deleteDashboardContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/dashboards/[dashboardId]',
  params: dashboardParamsSchema,
  response: { mode: 'json', schema: deletedResponse },
})
export const dashboardFolderPathSchema = z.string().min(1).max(2048)
export const createDashboardFolderBodySchema = z
  .object({ path: dashboardFolderPathSchema })
  .strict()
export const moveDashboardFolderBodySchema = createDashboardFolderBodySchema.extend({
  destinationPath: dashboardFolderPathSchema,
})
export const listDashboardFoldersContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/dashboards/folders',
  params: workspaceParams,
  response: { mode: 'json', schema: z.object({ folders: z.array(folderSchema) }) },
})
export const createDashboardFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/dashboards/folders',
  params: workspaceParams,
  body: createDashboardFolderBodySchema,
  response: { mode: 'json', schema: z.object({ folder: folderSchema }) },
})
export const moveDashboardFolderContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workspaces/[id]/dashboards/folders',
  params: workspaceParams,
  body: moveDashboardFolderBodySchema,
  response: { mode: 'json', schema: z.object({ folder: folderSchema }) },
})
export const deleteDashboardFolderContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/dashboards/folders',
  params: workspaceParams,
  body: createDashboardFolderBodySchema,
  response: { mode: 'json', schema: deletedResponse },
})
export type DashboardRecord = z.output<typeof dashboardRecordSchema>
export type CreateDashboardBody = z.input<typeof createDashboardBodySchema>
export type UpdateDashboardBody = z.input<typeof updateDashboardBodySchema>
export type MoveDashboardBody = z.input<typeof moveDashboardBodySchema>
