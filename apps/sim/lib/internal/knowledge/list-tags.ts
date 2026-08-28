import { createExecutorPrincipal } from '@/lib/internal/principals/executor'
import { KNOWLEDGE_DELEGATION_AUDIENCE } from '@/lib/knowledge/application/authorization'
import { listKnowledgeTags } from '@/lib/knowledge/application/tags'

export interface ListKnowledgeTagsAsExecutorInput {
  knowledgeBaseId: string
  userId: string
  workspaceId: string
  workflowId: string
  executionId?: string
}

export async function listKnowledgeTagsAsExecutor({
  knowledgeBaseId,
  userId,
  workspaceId,
  workflowId,
  executionId,
}: ListKnowledgeTagsAsExecutorInput) {
  const principal = await createExecutorPrincipal({
    userId,
    workflowId,
    ...(executionId ? { executionId } : {}),
    audience: KNOWLEDGE_DELEGATION_AUDIENCE,
  })
  const result = await listKnowledgeTags.execute({
    principal,
    input: { knowledgeBaseId, assertedWorkspaceId: workspaceId },
  })
  return result.tagDefinitions
}
