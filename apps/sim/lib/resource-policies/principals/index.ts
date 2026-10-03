export { credentialGroupActorResourcePolicyPrincipalSchema } from '@/lib/resource-policies/principals/credential-group-actor'
export { knowledgeConnectorResourcePolicyPrincipalSchema } from '@/lib/resource-policies/principals/knowledge-connector'
export {
  getResourcePolicyPrincipalDefinition,
  matchResourcePolicyPrincipal,
  RESOURCE_POLICY_PRINCIPAL_DEFINITIONS,
  requireResourcePolicyPrincipalDefinition,
} from '@/lib/resource-policies/principals/registry'
export type {
  CredentialGroupActorResourcePolicyPrincipal,
  KnowledgeConnectorResourcePolicyPrincipal,
  ResourcePolicyPrincipal,
  ResourcePolicyPrincipalDefinition,
  ResourcePolicyPrincipalEvaluationFacts,
  ResourcePolicyPrincipalSelector,
  ResourcePolicyPrincipalType,
  WorkflowResourcePolicyPrincipal,
} from '@/lib/resource-policies/principals/types'
export { workflowResourcePolicyPrincipalSchema } from '@/lib/resource-policies/principals/workflow'
