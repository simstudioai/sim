import { createLogger } from '@sim/logger'
import type { EnrichmentInput } from '@/lib/internal/enrichment/schema'
import { getEnrichment } from '@/enrichments/registry'
import { runEnrichment } from '@/enrichments/run'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('EnrichmentOperations')

export interface EnrichmentOperationContext {
  workspaceId: string
  signal?: AbortSignal
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
}

export async function executeEnrichment(
  input: EnrichmentInput,
  context: EnrichmentOperationContext
): Promise<Response> {
  context.signal?.throwIfAborted()
  const enrichment = getEnrichment(input.enrichmentId)
  if (!enrichment) {
    return Response.json({ error: `Unknown enrichment "${input.enrichmentId}"` }, { status: 400 })
  }

  const { result, cost, error, provider } = await runEnrichment(enrichment, input.inputs, {
    workspaceId: context.workspaceId,
    signal: context.signal,
    resolvedSecretTraceRegistry: context.resolvedSecretTraceRegistry,
  })
  context.signal?.throwIfAborted()
  const matched = Object.keys(result).length > 0
  logger.info('Enrichment block run', { enrichmentId: input.enrichmentId, matched, provider })
  return Response.json({ matched, result, cost, error, provider })
}
