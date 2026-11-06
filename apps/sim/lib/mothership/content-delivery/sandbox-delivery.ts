import { createLogger } from '@sim/logger'
import type { ContentDeliveryGate } from '@/lib/core/application'
import { ContentGateFailure } from '@/lib/core/application'
import {
  dispatchUnderContentGate,
  markCommittedWriteResponse,
} from '@/lib/mothership/content-delivery/dispatch'
import { WorkbenchProvenanceUnavailableError } from '@/lib/mothership/content-delivery/session-gate'

const logger = createLogger('MothershipSandboxDelivery')

/**
 * Runs one sandbox callback under the workbench's content gate. When the machine's history cannot
 * be widened for what the request read, its result is withheld: a mutation may already have
 * committed, so the response says so and is never retried on the caller's behalf.
 */
export async function deliverSandboxResponse(
  gate: ContentDeliveryGate,
  dispatch: () => Promise<Response>,
  toolCallId: string
): Promise<Response> {
  try {
    return (await dispatchUnderContentGate(gate, dispatch)).response
  } catch (error) {
    if (
      !(error instanceof ContentGateFailure) ||
      !(error.gateFailure instanceof WorkbenchProvenanceUnavailableError)
    ) {
      throw error
    }
    logger.warn('Sandbox response provenance could not be recorded', { toolCallId })
    const withheld = Response.json(
      {
        error: error.committedWrite
          ? 'The change was saved, but its result could not be returned safely. Do not retry the change.'
          : 'The API request ran, but its result could not be returned safely. Do not retry a mutation automatically; read the resource to check its current state.',
      },
      { status: 502 }
    )
    return error.committedWrite ? markCommittedWriteResponse(withheld) : withheld
  }
}
