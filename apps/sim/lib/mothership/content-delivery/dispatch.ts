import {
  type ContentDeliveryGate,
  ContentGateFailure,
  type ContentProvenance,
  observeContentDelivery,
  trackContentDelivery,
} from '@/lib/core/application'
import {
  mergeWorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import { parseWorkspaceFileSecretProvenance } from '@/lib/uploads/upload-session/workspace-file-provenance'
import { v2Error } from '@/app/api/v2/lib/response'

const UNCLASSIFIED_CONTENT_MESSAGE =
  'This result cannot be returned to Chat because its content was not checked for secret values.'

const committedWrites = new WeakSet<Response>()

/**
 * Whether a refused or failed response answers a write that committed: the change happened even
 * though its result is withheld, so what it changed still needs refreshing.
 */
export function isCommittedWriteResponse(response: Response): boolean {
  return committedWrites.has(response)
}

/** Marks a response a transport built itself for a write that committed; see above. */
export function markCommittedWriteResponse(response: Response): Response {
  committedWrites.add(response)
  return response
}

/**
 * Dispatches one Chat request under `gate`, whatever its method. A successful response from an
 * operation declared to return stored content that never classified it is replaced by a `403`, so
 * a route that forgets to report its content fails closed instead of passing it to a model. A
 * failure of the gate itself is rethrown, for the transport to answer.
 */
export async function dispatchUnderContentGate(
  gate: ContentDeliveryGate,
  dispatch: () => Promise<Response>
): Promise<{ response: Response; admitted: readonly ContentProvenance[] }> {
  const record = await observeContentDelivery(gate, () => trackContentDelivery(dispatch))
  if (record.committedWrite) committedWrites.add(record.result)
  /**
   * A gate that failed to decide is the transport's to answer, not the route's: the route mapped
   * it to a generic error, and a write it interrupted may already have committed.
   */
  if (record.gateFailure !== undefined) {
    await record.result.body?.cancel().catch(() => {})
    throw new ContentGateFailure(record.gateFailure, record.committedWrite)
  }
  if (record.unaccounted && record.result.ok) {
    await record.result.body?.cancel().catch(() => {})
    return { response: v2Error('FORBIDDEN', UNCLASSIFIED_CONTENT_MESSAGE), admitted: [] }
  }
  return { response: record.result, admitted: record.admitted }
}

/**
 * The classification a persisted copy of the delivered bytes keeps. An entry with no owner cannot
 * be re-bound to a file, so it reads as unknown rather than as clean.
 */
export function deliveredFileProvenance(
  admitted: readonly ContentProvenance[]
): WorkspaceFileSecretProvenance {
  return mergeWorkspaceFileSecretProvenance(...admitted.map(parseWorkspaceFileSecretProvenance))
}
