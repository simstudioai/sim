export { CREDENTIAL_GROUP_ACTOR_OWNS_CREDENTIAL_CONDITION_KEY } from '@/lib/resource-policies/conditions/credential-group-actor-owns-credential'
export {
  getResourcePolicyConditionDefinition,
  RESOURCE_POLICY_CONDITION_DEFINITIONS,
  requireResourcePolicyConditionDefinition,
} from '@/lib/resource-policies/conditions/registry'
export type {
  ResourcePolicyConditionDefinition,
  ResourcePolicyConditionEvaluationFacts,
  ResourcePolicyConditionKey,
  ResourcePolicyConditionOperator,
  ResourcePolicyConditionSelector,
  ResourcePolicyConditionValueType,
} from '@/lib/resource-policies/conditions/types'
export { RESOURCE_POLICY_CONDITION_OPERATORS } from '@/lib/resource-policies/conditions/types'
