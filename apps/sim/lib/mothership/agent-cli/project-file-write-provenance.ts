import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { AgentCliExecutionContext } from '@/lib/mothership/agent-cli'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

/** The invocation a Project write checks, and the registry holding its source's committed provenance. */
export interface ProjectFileProvenanceOptions {
  context: AgentCliExecutionContext
  resolveSecretTraceRegistry?: () => Promise<ResolvedSecretTraceRegistry>
}

/** Shared metadata is public even when the file's bytes retain protected provenance. */
export async function requireCleanProjectFileMetadata(
  value: unknown,
  options: ProjectFileProvenanceOptions
): Promise<void> {
  const { context } = options
  context.signal?.throwIfAborted()
  const registry = options.resolveSecretTraceRegistry
    ? await options.resolveSecretTraceRegistry()
    : context.resolvedSecretTraceRegistry
  const provenance = registry?.exportCommittedProvenanceForValue(value, { anonymous: true })
  if (!provenance?.complete || provenance.entries.length !== 0)
    throw new OrchestrationError(
      'forbidden',
      'Project file metadata or content cannot be published without complete, empty secret provenance'
    )
}
