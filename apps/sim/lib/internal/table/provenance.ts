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

export function readTableToolProvenanceEnvelope(
  headers: Headers,
  payload: unknown
): TableRowProvenanceEnvelope {
  const inspection = inspectPrivateSecretProvenanceRequest(headers, payload)
  if (inspection.status === 'unsupported') return { kind: 'none' }
  if (inspection.status !== 'verified') throw new TableRowProvenanceError()
  return { kind: 'bundle', value: inspection.value }
}

export function tableToolRequestsProvenance(headers: Headers): boolean {
  const negotiation = negotiatePrivateToolMetadataResponse(
    headers,
    RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    true
  )
  if (negotiation.status === 'rejected') throw new TableRowProvenanceError()
  return negotiation.status !== 'not-requested'
}

export function createTableToolResponse(
  body: Record<string, unknown>,
  provenance?: unknown
): Response {
  if (provenance === undefined) return Response.json(body)
  const envelope = serializePrivateToolMetadataResponseEnvelope(
    body,
    RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    provenance
  )
  return Response.json(envelope.body, { headers: envelope.headers })
}
