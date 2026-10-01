import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'

const workspaceParams = z.object({ id: workspaceIdSchema })
export const dashboardContentSchema = z
  .string()
  .min(1)
  .max(128 * 1024)
export const dashboardRevisionSchema = z.string().min(1).max(256)
export const dashboardRecordSchema = z.object({
  id: z.string(),
  type: z.literal('dashboard'),
  name: z.string(),
  updatedAt: z.string(),
  revision: dashboardRevisionSchema,
})

/** A workspace has at most one dashboard, which Sim builds; both fields are null until then. */
export const readWorkspaceDashboardContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/dashboard',
  params: workspaceParams,
  response: {
    mode: 'json',
    schema: z.object({
      dashboard: dashboardRecordSchema.nullable(),
      content: dashboardContentSchema.nullable(),
    }),
  },
})
export type DashboardRecord = z.output<typeof dashboardRecordSchema>
