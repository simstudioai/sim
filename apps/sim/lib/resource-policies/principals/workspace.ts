import { z } from 'zod'
import { defineResourcePolicyPrincipal } from '@/lib/resource-policies/principals/types'

export const workspaceResourcePolicyPrincipalSchema = z
  .object({
    type: z.literal('workspace'),
    workspaceId: z
      .string()
      .min(1)
      .max(128)
      .refine((id) => id === id.trim(), {
        message: 'Workspace ID must be canonical',
      }),
  })
  .strict()

export const workspaceResourcePolicyPrincipalDefinition = defineResourcePolicyPrincipal({
  type: 'workspace',
  schema: workspaceResourcePolicyPrincipalSchema,
  label: 'Workspace',
  selector: { type: 'catalog', catalog: 'workspaces' },
  matches: (principal, facts) => principal.workspaceId === facts.currentWorkspaceId,
})
