import type { NextRequest } from 'next/server'
import { inspectPrivateSecretProvenanceRequest } from '@/lib/execution/model-input-provenance'
import {
  negotiatePrivateToolMetadataResponse,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
  serializePrivateToolMetadataResponseEnvelope,
} from '@/lib/execution/private-tool-metadata'
import {
  type TableRowProvenanceEnvelope,
  TableRowProvenanceError,
} from '@/lib/table/application/row-secret-provenance'

/**
 * Reads the private provenance envelope off the request. Transport only — the
 * selections are interpreted against the canonical schema inside the use case,
 * by {@link resolveRowWriteProvenance}.
 */
export function readTableRowProvenanceEnvelope(
  request: NextRequest,
  payload: unknown
): TableRowProvenanceEnvelope {
  const inspection = inspectPrivateSecretProvenanceRequest(request.headers, payload)
  if (inspection.status === 'unsupported') return { kind: 'none' }
  if (inspection.status !== 'verified') throw new TableRowProvenanceError()
  return { kind: 'bundle', value: inspection.value }
}

/**
 * Whether this caller asked for persisted row provenance on the response.
 *
 * Only an authenticated internal caller that explicitly requested the capability
 * gets it; every ordinary UI and API response keeps its existing wire shape. The
 * answer feeds the use case's `includePersistedSecretProvenance`, so the load
 * itself happens inside the authorized operation rather than in the adapter.
 */
export function negotiateTableRowsProvenance(
  request: NextRequest,
  isInternalCaller: boolean
): boolean {
  const negotiation = negotiatePrivateToolMetadataResponse(
    request.headers,
    RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    isInternalCaller
  )
  if (negotiation.status === 'rejected') throw new TableRowProvenanceError()
  return negotiation.status !== 'not-requested'
}

/**
 * The response half of the envelope, shaped for a declarative route's
 * `finalizeResponse`: one sibling body field and one capability header, added
 * only when the use case actually loaded provenance.
 */
export function finalizeTableRowsProvenance(provenance: unknown): {
  bodyFields?: Record<string, unknown>
  headers?: HeadersInit
} {
  if (provenance === undefined) return {}
  const envelope = serializePrivateToolMetadataResponseEnvelope(
    {},
    RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    provenance
  )
  return { bodyFields: envelope.body, headers: envelope.headers }
}
