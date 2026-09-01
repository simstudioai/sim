import { z } from 'zod'
import { defineResourcePolicyPrincipal } from '@/lib/resource-policies/principals/types'

export const workflowResourcePolicyPrincipalSchema = z
  .object({
    type: z.literal('workflow'),
    workflowId: z
      .string()
      .min(1)
      .max(128)
      .refine((value) => value === value.trim(), 'Workflow ID must be canonical'),
  })
  .strict()

export const workflowResourcePolicyPrincipalDefinition = defineResourcePolicyPrincipal({
  type: 'workflow',
  schema: workflowResourcePolicyPrincipalSchema,
  label: 'Workflow',
  selector: { type: 'catalog', catalog: 'workflows' },
  matches: (principal, facts) => facts.currentWorkflow?.workflowId === principal.workflowId,
})
