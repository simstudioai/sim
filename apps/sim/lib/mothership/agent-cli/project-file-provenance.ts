import { OrchestrationError } from '@/lib/core/orchestration/types'
import { importDurableSecretProvenance } from '@/lib/execution/durable-secret-provenance'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

/**
 * Import the bound source entries before any Project file bytes reach an agent consumer. A caller
 * without a registry is refused outright: its egress could not redact and would withhold the
 * result anyway. With one, content recording no secret passes as it does for a workspace file
 * (`unrecorded`, or an exact empty set), while `unknown` or unimportable secrets are refused.
 */
export async function importProjectFileProvenance(
  registry: ResolvedSecretTraceRegistry | undefined,
  source: WorkspaceFileSecretProvenance | undefined
) {
  if (
    registry &&
    !registry.isPermanentlyIncomplete() &&
    (source?.status === 'unrecorded' || (source?.status === 'exact' && source.entries.length === 0))
  )
    return
  if (
    !registry ||
    source?.status !== 'exact' ||
    !(await importDurableSecretProvenance(registry, source)) ||
    registry.isPermanentlyIncomplete()
  ) {
    registry?.markIncomplete('project-file-provenance-unavailable')
    throw new OrchestrationError(
      'forbidden',
      'File content cannot be delivered without its secret provenance'
    )
  }
}

/**
 * Imports one search candidate's bound entries without latching the registry. False means this
 * file's text must stay out of the result; the search continues and reports it incomplete, so an
 * unknown sidecar on a file the agent never sees does not refuse the rest of the turn.
 */
export async function admitProjectFileProvenance(
  registry: ResolvedSecretTraceRegistry | undefined,
  source: WorkspaceFileSecretProvenance | undefined
): Promise<boolean> {
  if (!registry || registry.isPermanentlyIncomplete()) return false
  if (source?.status === 'unrecorded') return true
  if (source?.status !== 'exact') return false
  return (
    source.entries.length === 0 ||
    (await importDurableSecretProvenance(registry, source, undefined, { atomic: true }))
  )
}
