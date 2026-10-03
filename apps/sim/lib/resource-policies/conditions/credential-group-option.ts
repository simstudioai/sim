import { defineResourcePolicyCondition } from '@/lib/resource-policies/conditions/types'

export const CREDENTIAL_GROUP_OPTION_ID_CONDITION_KEY = 'credential_group:OptionId' as const

/**
 * The Credential Group option the credential being accessed was collected
 * under. A statement conditioned on it grants one option's credentials and no
 * other, which is how a knowledge connector is bound to exactly the provider
 * slot it crawls with.
 */
export const credentialGroupOptionIdConditionDefinition = defineResourcePolicyCondition({
  key: CREDENTIAL_GROUP_OPTION_ID_CONDITION_KEY,
  label: 'Credential option',
  valueType: 'string',
  operators: ['StringEquals'],
  selector: { type: 'internal' },
  resolve: (facts) => facts.credentialGroupOptionId,
})
