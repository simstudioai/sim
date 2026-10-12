import type { ContentDeliveryGate } from '@/lib/core/application/content-delivery'
import {
  type DurableSecretProvenance,
  EXACT_EMPTY_DURABLE_SECRET_PROVENANCE,
  mergeDurableSecretProvenance,
} from '@/lib/execution/durable-secret-provenance'
import { reportDurableSecretProvenanceUnrecordedBatch } from '@/lib/execution/durable-secret-provenance-telemetry'
import { recordExistingSessionFileInput } from '@/lib/execution/remote-sandbox/session-file-provenance'
import { reportContentRefusal } from '@/lib/mothership/content-delivery/telemetry'

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
  workspaceId: string
  actorUserId: string
}): ContentDeliveryGate {
  return {
    async admit(sources) {
      const verdicts: boolean[] = []
      const admitted: DurableSecretProvenance[] = []
      let unrecorded = 0
      for (const source of sources) {
        const { provenance } = source
        if (provenance.status === 'unknown') {
          verdicts.push(reportContentRefusal(source, 'unknown', scope.workspaceId))
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
