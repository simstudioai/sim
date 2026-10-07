import { OrchestrationError } from '@/lib/core/orchestration/types'
import { importDurableSecretProvenance } from '@/lib/execution/durable-secret-provenance'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

/** Import the bound source entries before any Project file bytes reach an agent consumer. */
export async function importProjectFileProvenance(
  registry: ResolvedSecretTraceRegistry | undefined,
  source: WorkspaceFileSecretProvenance | undefined
) {
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
