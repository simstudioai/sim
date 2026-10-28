import type { ContentDeliveryGate, ContentVerdict } from '@/lib/core/application'
import {
  createDurableSecretProvenanceRegistry,
  type DurableSecretProvenance,
  EXACT_EMPTY_DURABLE_SECRET_PROVENANCE,
  mergeDurableSecretProvenance,
} from '@/lib/execution/durable-secret-provenance'
import { reportDurableSecretProvenanceUnrecordedBatch } from '@/lib/execution/durable-secret-provenance-telemetry'
import { recordExistingSessionFileInput } from '@/lib/execution/remote-sandbox/session-file-provenance'
import { createContentRefusals } from '@/lib/mothership/content-delivery/telemetry'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'

/** The workbench's history could not be widened, so nothing may enter the machine. */
export class WorkbenchProvenanceUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Workbench secret provenance could not be recorded', { cause })
    this.name = 'WorkbenchProvenanceUnavailableError'
  }
}

/**
 * Decides items entering run_code's workbench. An unknown item never enters the machine, so the
 * machine's history stays exact and one tainted file cannot withhold every later run in the chat.
 * Everything admitted is merged into the history before its bytes are returned, which is what keeps
 * files the machine later derives from it carrying its secrets.
 */
export function createSessionContentGate(scope: {
  sessionKey: string
  /** Absent for a Project callback, which reads files no workspace owns. */
  workspaceId?: string
  actorUserId: string
}): ContentDeliveryGate {
  return {
    async project(text, provenance) {
      if (!provenance || provenance.status === 'unrecorded') return text
      try {
        const registry = await createDurableSecretProvenanceRegistry(provenance, {
          userId: scope.actorUserId,
          workspaceId: scope.workspaceId,
        })
        if (!registry) return text
        /** File extraction already bounds this scalar; final egress limits the selected output. */
        const projection = projectResolvedSecretModelContent(
          text,
          registry.forkForPropagatedEntries(),
          Number.POSITIVE_INFINITY,
          { preserveLineBreaks: true }
        )
        return projection.safe && typeof projection.value === 'string'
          ? projection.value
          : undefined
      } catch {
        return undefined
      }
    },
    async admit(sources) {
      const verdicts: ContentVerdict[] = []
      const admitted: DurableSecretProvenance[] = []
      const refusals = createContentRefusals(scope.workspaceId)
      let unrecorded = 0
      for (const source of sources) {
        const { provenance } = source
        if (provenance.status === 'unknown') {
          verdicts.push(refusals.refuse(source, 'unknown'))
          continue
        }
        if (
          provenance.status === 'exact' &&
          provenance.entries.length > 0 &&
          source.view === 'excerpt'
        ) {
          verdicts.push(refusals.refuse(source, 'opaque'))
          continue
        }
        if (provenance.status === 'unrecorded') {
          unrecorded += 1
          admitted.push(EXACT_EMPTY_DURABLE_SECRET_PROVENANCE)
        } else {
          admitted.push(provenance)
        }
        verdicts.push(true)
      }
      refusals.report()
      if (admitted.length > 0) {
        try {
          await recordExistingSessionFileInput(
            scope.sessionKey,
            mergeDurableSecretProvenance(...admitted)
          )
        } catch (error) {
          throw new WorkbenchProvenanceUnavailableError(error)
        }
      }
      if (unrecorded > 0) {
        reportDurableSecretProvenanceUnrecordedBatch([
          {
            surface: 'workspace-file',
            workspaceId: scope.workspaceId,
            actorUserId: scope.actorUserId,
            recordCount: unrecorded,
          },
        ])
      }
      return verdicts
    },
  }
}
