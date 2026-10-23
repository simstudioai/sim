import type { ContentDeliveryGate, ContentSource, ContentVerdict } from '@/lib/core/application'
import { importDurableSecretProvenance } from '@/lib/execution/durable-secret-provenance'
import {
  type DurableSecretProvenanceUnrecordedReport,
  reportDurableSecretProvenanceUnrecordedBatch,
} from '@/lib/execution/durable-secret-provenance-telemetry'
import {
  CONTENT_SURFACE,
  type ContentRefusals,
  createContentRefusals,
} from '@/lib/mothership/content-delivery/telemetry'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

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
  /** Private workbench downloads persist imported provenance; opaque bytes never go directly to the model. */
  destination?: 'model' | 'workbench'
}

/**
 * Decides items against a model registry: an item's exact secrets are imported so egress redacts
 * them. Atomic admission checks decryption and the registry's remaining capacity before activating
 * any entry, so a refused item cannot latch the registry for every other item.
 */
export function createRegistryContentGate(scope: RegistryContentGateScope): ContentDeliveryGate {
  const decide = async (
    source: ContentSource,
    unrecorded: DurableSecretProvenanceUnrecordedReport[],
    { refuse }: ContentRefusals
  ): Promise<ContentVerdict> => {
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
    if (
      source.view === 'excerpt' ||
      (source.view === 'opaque' && scope.destination !== 'workbench')
    )
      return refuse(source, 'opaque')
    const registry = scope.registry
    if (!registry) return refuse(source, 'registry')
    /** A derived view that shows nothing needs no entry; `undefined` would mean the whole item. */
    if (typeof source.view === 'object' && source.view.derived === undefined) return true
    const value = typeof source.view === 'object' ? source.view.derived : undefined
    if (!(await importDurableSecretProvenance(registry, provenance, value, { atomic: true }))) {
      return refuse(source, 'import')
    }
    return true
  }

  return {
    project(text) {
      /** Without a registry no admitted item holds a secret, so there is nothing to redact. */
      if (!scope.registry) return text
      /** File extraction already bounds this scalar; final egress limits the selected output. */
      const projection = projectResolvedSecretModelContent(
        text,
        scope.registry.forkForPropagatedEntries(),
        Number.POSITIVE_INFINITY,
        { preserveLineBreaks: true }
      )
      return projection.safe && typeof projection.value === 'string' ? projection.value : undefined
    },
    async admit(sources) {
      const unrecorded: DurableSecretProvenanceUnrecordedReport[] = []
      const refusals = createContentRefusals(scope.workspaceId)
      const verdicts: ContentVerdict[] = []
      try {
        for (const source of sources) verdicts.push(await decide(source, unrecorded, refusals))
      } finally {
        refusals.report()
      }
      reportDurableSecretProvenanceUnrecordedBatch(unrecorded)
      return verdicts
    },
  }
}
