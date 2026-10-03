import type { Principal } from '@sim/auth/principal'
import type {
  WorkspaceAuthorizationContext,
  WorkspaceAuthorizationOptions,
} from '@/lib/core/application'

export const KNOWLEDGE_DELEGATION_AUDIENCE = 'sim:knowledge'

interface KnowledgeResourceIdentifiers {
  knowledgeBaseId?: string
  documentId?: string
  chunkId?: string
  tagDefinitionId?: string
  connectorId?: string
}

export interface KnowledgeAuthorizationContext
  extends WorkspaceAuthorizationContext,
    KnowledgeResourceIdentifiers {
  organizationId?: undefined
}

export interface KnowledgeOrganizationAuthorizationContext extends KnowledgeResourceIdentifiers {
  organizationId: string
  workspaceId: undefined
}

export type KnowledgeResourceAuthorizationContext =
  | KnowledgeAuthorizationContext
  | KnowledgeOrganizationAuthorizationContext

export type KnowledgeAuthorizationOptions = Omit<
  WorkspaceAuthorizationOptions<KnowledgeAuthorizationContext>,
  'delegation'
>

export const knowledgeDelegationPolicy = {
  audience: KNOWLEDGE_DELEGATION_AUDIENCE,
  isWithinScope(
    delegated: Extract<Principal, { kind: 'delegated' }>,
    canonicalContext: KnowledgeAuthorizationContext
  ) {
    return delegated.workspaceId === canonicalContext.workspaceId
  },
} as const
