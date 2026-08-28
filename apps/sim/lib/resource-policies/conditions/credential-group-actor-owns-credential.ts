import { defineResourcePolicyCondition } from '@/lib/resource-policies/conditions/types'

export const CREDENTIAL_GROUP_ACTOR_OWNS_CREDENTIAL_CONDITION_KEY =
  'credential_group:ActorOwnsCredential' as const

export const credentialGroupActorOwnsCredentialConditionDefinition = defineResourcePolicyCondition({
  key: CREDENTIAL_GROUP_ACTOR_OWNS_CREDENTIAL_CONDITION_KEY,
  label: 'Actor owns credential',
  valueType: 'boolean',
  operators: ['Bool'],
  selector: { type: 'internal' },
  resolve: (facts) => {
    if (
      facts.credentialGroupActorEnrollmentId === undefined ||
      facts.credentialGroupCredentialEnrollmentId === undefined
    ) {
      return undefined
    }
    return facts.credentialGroupActorEnrollmentId === facts.credentialGroupCredentialEnrollmentId
  },
})
