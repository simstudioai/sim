import { z } from 'zod'
import { dashboardContentSchema, dashboardRevisionSchema } from '@/lib/api/contracts/dashboards'

const scope = z.object({ workspaceId: z.string().min(1).max(100).optional() })
/** A workspace has one dashboard: read it, then save it (the first save creates it). */
export const mothershipDashboardsInputSchema = z.discriminatedUnion('action', [
  scope.extend({ action: z.literal('get') }).strict(),
  scope
    .extend({
      action: z.literal('set'),
      content: dashboardContentSchema,
      expectedRevision: dashboardRevisionSchema
        .optional()
        .describe('The revision from `dashboards get`; required once the dashboard exists.'),
    })
    .strict(),
])
