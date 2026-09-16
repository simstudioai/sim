import type { ResourcePolicyConditionKey } from '@/lib/resource-policies/conditions'
import type { ResourcePolicyPrincipalType } from '@/lib/resource-policies/principals'

export const RESOURCE_POLICY_RESOURCE_TYPES = ['credential_group'] as const
export const CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION = 'credential_groups.credentials.use' as const
export const RESOURCE_POLICY_ACTIONS = [CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION] as const

export type ResourcePolicyResourceType = (typeof RESOURCE_POLICY_RESOURCE_TYPES)[number]
export type ResourcePolicyAction = (typeof RESOURCE_POLICY_ACTIONS)[number]

interface ResourcePolicyResourceDefinition {
  actions: readonly ResourcePolicyAction[]
  principalTypes: readonly ResourcePolicyPrincipalType[]
  conditionKeys: readonly ResourcePolicyConditionKey[]
}

export const RESOURCE_POLICY_DEFINITIONS = Object.freeze({
  credential_group: {
    actions: RESOURCE_POLICY_ACTIONS,
    principalTypes: ['credential_group_actor', 'knowledge_connector', 'workflow', 'workspace'],
    conditionKeys: [
      'credential_group:ActorOwnsCredential',
      'credential_group:OptionId',
      'execution:WorkflowMode',
    ],
  },
} as const satisfies Record<ResourcePolicyResourceType, ResourcePolicyResourceDefinition>)

type ResourcePolicyDefinitionMap = typeof RESOURCE_POLICY_DEFINITIONS

export type ResourcePolicyBinding = {
  [ResourceType in ResourcePolicyResourceType]: {
    readonly resourceType: ResourceType
    readonly action: ResourcePolicyDefinitionMap[ResourceType]['actions'][number]
  }
}[ResourcePolicyResourceType]

export type ResourcePolicyBindingFor<ResourceType extends ResourcePolicyResourceType> = Extract<
  ResourcePolicyBinding,
  { readonly resourceType: ResourceType }
>

export function getResourcePolicyDefinition(
  resourceType: ResourcePolicyResourceType
): ResourcePolicyResourceDefinition {
  return RESOURCE_POLICY_DEFINITIONS[resourceType]
}

export function requireResourcePolicyBinding(binding: ResourcePolicyBinding): void {
  if (
    !RESOURCE_POLICY_RESOURCE_TYPES.some((resourceType) => resourceType === binding.resourceType)
  ) {
    throw new Error(`Unknown resource policy resource type: ${binding.resourceType}`)
  }
  const definition = getResourcePolicyDefinition(binding.resourceType)
  if (!definition.actions.includes(binding.action)) {
    throw new Error(
      `Action ${binding.action} does not apply to resource policy type ${binding.resourceType}`
    )
  }
}
