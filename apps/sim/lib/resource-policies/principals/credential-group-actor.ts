import { z } from 'zod'
import { defineResourcePolicyPrincipal } from '@/lib/resource-policies/principals/types'

export const credentialGroupActorResourcePolicyPrincipalSchema = z
  .object({ type: z.literal('credential_group_actor') })
  .strict()

export const credentialGroupActorResourcePolicyPrincipalDefinition = defineResourcePolicyPrincipal({
  type: 'credential_group_actor',
  schema: credentialGroupActorResourcePolicyPrincipalSchema,
  label: 'Credential Group actor',
  selector: { type: 'internal' },
  matches: (_principal, facts) => facts.credentialGroupActorEnrollmentId !== undefined,
})
