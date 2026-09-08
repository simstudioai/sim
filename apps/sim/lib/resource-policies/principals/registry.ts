import { credentialGroupActorResourcePolicyPrincipalDefinition } from '@/lib/resource-policies/principals/credential-group-actor'
import { knowledgeConnectorResourcePolicyPrincipalDefinition } from '@/lib/resource-policies/principals/knowledge-connector'
import type {
  ResourcePolicyPrincipal,
  ResourcePolicyPrincipalDefinition,
  ResourcePolicyPrincipalEvaluationFacts,
  ResourcePolicyPrincipalType,
} from '@/lib/resource-policies/principals/types'
import { workflowResourcePolicyPrincipalDefinition } from '@/lib/resource-policies/principals/workflow'
import { workspaceResourcePolicyPrincipalDefinition } from '@/lib/resource-policies/principals/workspace'

export const RESOURCE_POLICY_PRINCIPAL_DEFINITIONS = Object.freeze({
  credential_group_actor: credentialGroupActorResourcePolicyPrincipalDefinition,
  knowledge_connector: knowledgeConnectorResourcePolicyPrincipalDefinition,
  workflow: workflowResourcePolicyPrincipalDefinition,
  workspace: workspaceResourcePolicyPrincipalDefinition,
} as const satisfies Record<ResourcePolicyPrincipalType, ResourcePolicyPrincipalDefinition>)

export function getResourcePolicyPrincipalDefinition(
  type: ResourcePolicyPrincipalType
): ResourcePolicyPrincipalDefinition {
  return RESOURCE_POLICY_PRINCIPAL_DEFINITIONS[type]
}

export function requireResourcePolicyPrincipalDefinition(
  type: string
): ResourcePolicyPrincipalDefinition {
  if (!Object.hasOwn(RESOURCE_POLICY_PRINCIPAL_DEFINITIONS, type)) {
    throw new Error(`Resource policy principal type ${type} is not registered`)
  }
  return RESOURCE_POLICY_PRINCIPAL_DEFINITIONS[type as ResourcePolicyPrincipalType]
}

export function matchResourcePolicyPrincipal(
  principal: ResourcePolicyPrincipal,
  facts: ResourcePolicyPrincipalEvaluationFacts
): boolean {
  return getResourcePolicyPrincipalDefinition(principal.type).matches(principal, facts)
}
