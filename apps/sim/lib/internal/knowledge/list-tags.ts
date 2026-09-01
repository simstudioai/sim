import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { listKnowledgeTags } from '@/lib/knowledge/application/tags'

export interface ListKnowledgeTagsAsExecutorInput {
  knowledgeBaseId: string
  workspaceId: string
  context: InternalToolOperationContext
}

export async function listKnowledgeTagsAsExecutor({
  knowledgeBaseId,
  workspaceId,
  context,
}: ListKnowledgeTagsAsExecutorInput) {
  const principal = await createExecutorPrincipalFromExecutionContext({
    context,
  })
  const result = await listKnowledgeTags.execute({
    principal,
    input: { knowledgeBaseId, assertedWorkspaceId: workspaceId },
  })
  return result.tagDefinitions
}
