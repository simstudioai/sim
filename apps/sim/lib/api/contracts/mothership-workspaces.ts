import {
  listWorkspacesInputSchema,
  listWorkspacesResultSchema,
} from '@/lib/api/contracts/mothership-assistant-tools'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const readWorkspaceContextContract = defineRouteContract({
  method: 'POST',
  path: '/api/mothership/workspaces/context',
  body: listWorkspacesInputSchema.pick({ workspaceId: true }).required(),
  response: { mode: 'json', schema: listWorkspacesResultSchema },
})
