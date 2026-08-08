import type { Principal } from '@sim/auth/principal'
import type {
  WorkspaceAuthorizationContext,
  WorkspaceAuthorizationOptions,
} from '@/lib/core/application'

export const KNOWLEDGE_DELEGATION_AUDIENCE = 'sim:knowledge'

export interface KnowledgeAuthorizationContext extends WorkspaceAuthorizationContext {
  knowledgeBaseId?: string
  documentId?: string
}

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
    return (
      delegated.serviceId === 'copilot' && delegated.workspaceId === canonicalContext.workspaceId
    )
  },
} as const
