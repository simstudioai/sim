import type { ContentDeliveryGate, ContentSource } from '@/lib/core/application/content-delivery'
import { importDurableSecretProvenance } from '@/lib/execution/durable-secret-provenance'
import {
  type DurableSecretProvenanceUnrecordedReport,
  reportDurableSecretProvenanceUnrecordedBatch,
} from '@/lib/execution/durable-secret-provenance-telemetry'
import {
  CONTENT_SURFACE,
  type ContentRefusalReason,
  reportContentRefusal,
} from '@/lib/mothership/content-delivery/telemetry'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

export interface RegistryContentGateScope {
  /** The registry whose projection is the output Chat's model receives. */
  registry?: ResolvedSecretTraceRegistry
  workspaceId?: string
  organizationId?: string
  actorUserId: string
  /**
   * `taint` admits an unknown item and latches the registry, so the whole output is withheld and
   * anything persisted from it stays unknown. Only a direct single-file download takes it (D7).
   */
  unknown?: 'refuse' | 'taint'
}

/**
 * Decides items against a model registry: an item's exact secrets are imported so egress redacts
 * them. Each item is first imported into a throwaway registry, so an item whose secrets cannot be
 * imported is refused on its own instead of latching the registry for every other item.
 */
export function createRegistryContentGate(scope: RegistryContentGateScope): ContentDeliveryGate {
  const refuse = (source: ContentSource, reason: ContentRefusalReason): false =>
    reportContentRefusal(source, reason, scope.workspaceId)

  const decide = async (
    source: ContentSource,
    unrecorded: DurableSecretProvenanceUnrecordedReport[]
  ): Promise<boolean> => {
    const { provenance } = source
    if (provenance.status === 'unknown') {
      /** Taint needs a registry to latch; without one the bytes would reach the model as is. */
      if (scope.unknown !== 'taint' || !scope.registry) return refuse(source, 'unknown')
      scope.registry.markIncomplete('workspace-file-provenance-unknown')
      return true
    }
    if (provenance.status === 'unrecorded') {
      unrecorded.push({
        surface: CONTENT_SURFACE[source.kind],
        workspaceId: scope.workspaceId,
        organizationId: scope.organizationId,
        resourceId: source.id,
        actorUserId: scope.actorUserId,
      })
      return true
    }
    if (provenance.entries.length === 0) return true
    if (source.view === 'opaque') return refuse(source, 'opaque')
    const registry = scope.registry
    if (!registry) return refuse(source, 'registry')
    const value = typeof source.view === 'object' ? source.view.derived : undefined
    const staged = new ResolvedSecretTraceRegistry([], undefined, { staged: true })
    if (!(await importDurableSecretProvenance(staged, provenance, value))) {
      return refuse(source, 'import')
    }
    /**
     * The staged import proved every entry decrypts, so this one only activates them. Its result
     * also reflects whether the registry was already incomplete for another reason; that output is
     * withheld anyway, so this item is not refused for it.
     */
    await importDurableSecretProvenance(registry, provenance, value)
    return true
  }

  return {
    async admit(sources) {
      const unrecorded: DurableSecretProvenanceUnrecordedReport[] = []
      const verdicts: boolean[] = []
      for (const source of sources) verdicts.push(await decide(source, unrecorded))
      reportDurableSecretProvenanceUnrecordedBatch(unrecorded)
      return verdicts
    },
  }
}
