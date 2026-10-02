import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'

export const workspaceSettingsNavigationSchema = z.object({
  sections: z
    .array(
      z.object({
        id: z.enum([
          'teammates',
          'secrets',
          'byok',
          'sandboxes',
          'custom-tools',
          'mcp',
          'workflow-mcp-servers',
          'api-keys',
          'inbox',
          'recently-deleted',
          'forks',
          'custom-blocks',
          'requests',
          'self-host',
        ]),
        access: z.enum(['allowed', 'request-access']),
      })
    )
    .max(32),
})
export type WorkspaceSettingsNavigation = z.output<typeof workspaceSettingsNavigationSchema>

export const getWorkspaceSettingsNavigationContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/settings-navigation',
  params: z.object({ id: workspaceIdSchema }),
  response: { mode: 'json', schema: workspaceSettingsNavigationSchema },
})
