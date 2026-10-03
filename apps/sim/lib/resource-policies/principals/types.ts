import type { ZodType } from 'zod'

export interface WorkflowResourcePolicyPrincipal {
  type: 'workflow'
  workflowId: string
}

export interface WorkspaceResourcePolicyPrincipal {
  type: 'workspace'
  workspaceId: string
}

export interface CredentialGroupActorResourcePolicyPrincipal {
  type: 'credential_group_actor'
}

export interface KnowledgeConnectorResourcePolicyPrincipal {
  type: 'knowledge_connector'
  connectorId: string
}

export type ResourcePolicyPrincipal =
  | WorkspaceResourcePolicyPrincipal
  | WorkflowResourcePolicyPrincipal
  | CredentialGroupActorResourcePolicyPrincipal
  | KnowledgeConnectorResourcePolicyPrincipal
export type ResourcePolicyPrincipalType = ResourcePolicyPrincipal['type']

export interface ResourcePolicyPrincipalEvaluationFacts {
  currentWorkspaceId?: string
  credentialGroupActorEnrollmentId?: string
  currentWorkflow?: {
    workflowId: string
    mode: 'draft' | 'deployment'
  }
  currentKnowledgeConnector?: {
    connectorId: string
  }
}

export type ResourcePolicyPrincipalSelector =
  | { type: 'catalog'; catalog: 'workflows' | 'workspaces' }
  | { type: 'internal' }

export interface ResourcePolicyPrincipalDefinition<
  Principal extends ResourcePolicyPrincipal = ResourcePolicyPrincipal,
> {
  type: Principal['type']
  schema: ZodType<Principal>
  label: string
  selector: ResourcePolicyPrincipalSelector
  matches(principal: Principal, facts: ResourcePolicyPrincipalEvaluationFacts): boolean
}

export function defineResourcePolicyPrincipal<Principal extends ResourcePolicyPrincipal>(
  definition: ResourcePolicyPrincipalDefinition<Principal>
): ResourcePolicyPrincipalDefinition<Principal> {
  if (!definition.label.trim()) {
    throw new Error(`Resource policy principal ${definition.type} requires a label`)
  }
  return Object.freeze(definition)
}
