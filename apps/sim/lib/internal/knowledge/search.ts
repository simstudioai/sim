import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { KNOWLEDGE_DELEGATION_AUDIENCE } from '@/lib/knowledge/application/authorization'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import type {
  ResolvedSecretInputPath,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

export interface SearchKnowledgeAsExecutorInput {
  knowledgeBaseIds: string[]
  query: string
  topK: number
  workspaceId: string
  context: InternalToolOperationContext
  billingAttribution: BillingAttributionSnapshot
  resolvedSecretTraceRegistry: ResolvedSecretTraceRegistry
  modelInputPaths: readonly ResolvedSecretInputPath[]
  signal?: AbortSignal
}

export async function searchKnowledgeAsExecutor({
  knowledgeBaseIds,
  query,
  topK,
  workspaceId,
  context,
  billingAttribution,
  resolvedSecretTraceRegistry,
  modelInputPaths,
  signal,
}: SearchKnowledgeAsExecutorInput) {
  signal?.throwIfAborted()
  const principal = await createExecutorPrincipalFromExecutionContext({
    context,
    audience: KNOWLEDGE_DELEGATION_AUDIENCE,
  })
  const resultSecretRegistry = resolvedSecretTraceRegistry.forkForInputPaths(modelInputPaths)
  if (!resultSecretRegistry.isComplete()) {
    throw new Error('Knowledge model input provenance is unavailable')
  }

  const result = await searchKnowledge.execute({
    principal,
    input: {
      workspaceId,
      knowledgeBaseIds,
      query,
      topK,
      surface: 'workflow',
      resolveBillingAttribution: async () => billingAttribution,
      resultSecretRegistry,
    },
  })
  signal?.throwIfAborted()
  if (!result.resultSecretRegistry?.isComplete()) {
    throw new Error('Knowledge result secret provenance is unavailable')
  }
  return { results: result.results, registry: result.resultSecretRegistry }
}
