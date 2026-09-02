import { credentialGroupActorOwnsCredentialConditionDefinition } from '@/lib/resource-policies/conditions/credential-group-actor-owns-credential'
import { credentialGroupOptionIdConditionDefinition } from '@/lib/resource-policies/conditions/credential-group-option'
import type {
  ResourcePolicyConditionDefinition,
  ResourcePolicyConditionKey,
} from '@/lib/resource-policies/conditions/types'
import { workflowModeResourcePolicyConditionDefinition } from '@/lib/resource-policies/conditions/workflow-mode'

export const RESOURCE_POLICY_CONDITION_DEFINITIONS = Object.freeze({
  'credential_group:ActorOwnsCredential': credentialGroupActorOwnsCredentialConditionDefinition,
  'credential_group:OptionId': credentialGroupOptionIdConditionDefinition,
  'execution:WorkflowMode': workflowModeResourcePolicyConditionDefinition,
} as const satisfies Record<ResourcePolicyConditionKey, ResourcePolicyConditionDefinition>)

export function getResourcePolicyConditionDefinition(
  key: ResourcePolicyConditionKey
): ResourcePolicyConditionDefinition {
  return RESOURCE_POLICY_CONDITION_DEFINITIONS[key]
}

export function requireResourcePolicyConditionDefinition(
  key: string
): ResourcePolicyConditionDefinition {
  if (!Object.hasOwn(RESOURCE_POLICY_CONDITION_DEFINITIONS, key)) {
    throw new Error(`Resource policy condition key ${key} is not registered`)
  }
  return RESOURCE_POLICY_CONDITION_DEFINITIONS[key as ResourcePolicyConditionKey]
}
