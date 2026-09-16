import { defineResourcePolicyCondition } from '@/lib/resource-policies/conditions/types'

export const CREDENTIAL_TYPE_CONDITION_KEY = 'credential_group:CredentialType' as const

/** Resolves the integration from the canonical credential, independently of caller input. */
export const credentialTypeConditionDefinition = defineResourcePolicyCondition({
  key: CREDENTIAL_TYPE_CONDITION_KEY,
  label: 'Credential type',
  valueType: 'string',
  operators: ['StringEquals'],
  selector: { type: 'internal' },
  resolve: (facts) => facts.credentialType,
})
