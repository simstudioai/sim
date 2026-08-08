import type { DelegatedPrincipal } from '@sim/auth/principal'
import { KNOWLEDGE_DELEGATION_AUDIENCE } from '@/lib/knowledge/application/authorization'

const KNOWLEDGE_DELEGATION_TTL_MS = 5 * 60 * 1000

export interface CreateKnowledgeDelegatedPrincipalInput {
  serviceId: DelegatedPrincipal['serviceId']
  subjectUserId: string
  workspaceId: string
  delegationId: string
  chatId?: string
  executionId?: string
}

export function createKnowledgeDelegatedPrincipal(
  input: CreateKnowledgeDelegatedPrincipalInput
): DelegatedPrincipal {
  const issuedAt = new Date()
  return {
    kind: 'delegated',
    serviceId: input.serviceId,
    subjectUserId: input.subjectUserId,
    workspaceId: input.workspaceId,
    delegationId: input.delegationId,
    audience: KNOWLEDGE_DELEGATION_AUDIENCE,
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + KNOWLEDGE_DELEGATION_TTL_MS),
    resourceScope: {
      ...(input.chatId ? { chatId: input.chatId } : {}),
      ...(input.executionId ? { executionId: input.executionId } : {}),
    },
  }
}
