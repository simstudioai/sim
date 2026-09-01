import {
  type DurableSecretProvenance,
  durableSecretProvenanceFromPrivateBundle,
  importDurableSecretProvenance,
} from '@/lib/execution/durable-secret-provenance'
import {
  inspectPrivateSecretProvenanceRequest,
  isPrivateSecretProvenanceBundleV1,
} from '@/lib/execution/model-input-provenance'
import {
  negotiatePrivateToolMetadataResponse,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
  serializePrivateToolMetadataResponseEnvelope,
} from '@/lib/execution/private-tool-metadata'
import type {
  MemoryLegacyProvenanceScope,
  MemoryReadProvenance,
} from '@/lib/memory/application/use-cases'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

export class MemoryProvenanceError extends Error {
  constructor() {
    super('Invalid memory secret provenance')
    this.name = 'MemoryProvenanceError'
  }
}

export function memoryToolSuppliesWriteProvenance(headers: Headers, payload: unknown): boolean {
  return inspectPrivateSecretProvenanceRequest(headers, payload).status !== 'unsupported'
}

export function readMemoryWriteProvenance(
  headers: Headers,
  payload: unknown,
  scope: MemoryLegacyProvenanceScope
): DurableSecretProvenance | undefined {
  const inspection = inspectPrivateSecretProvenanceRequest(headers, payload)
  if (inspection.status === 'unsupported') return undefined
  if (inspection.status !== 'verified' || !isPrivateSecretProvenanceBundleV1(inspection.value)) {
    throw new MemoryProvenanceError()
  }
  if (!inspection.value.complete) return { status: 'unknown' }
  if (inspection.value.selections.length !== 1) throw new MemoryProvenanceError()

  const provenance = durableSecretProvenanceFromPrivateBundle(inspection.value, 'data', scope)
  if (!provenance) throw new MemoryProvenanceError()
  return provenance
}

export function memoryToolRequestsProvenance(headers: Headers): boolean {
  const negotiation = negotiatePrivateToolMetadataResponse(
    headers,
    RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    true
  )
  if (negotiation.status === 'rejected') throw new MemoryProvenanceError()
  return negotiation.status !== 'not-requested'
}

export async function createMemoryToolResponse(
  body: Record<string, unknown>,
  provenance: MemoryReadProvenance[] | undefined,
  scope: MemoryLegacyProvenanceScope | undefined
): Promise<Response> {
  if (provenance === undefined) return Response.json(body)
  if (!scope) throw new MemoryProvenanceError()

  const registry = new ResolvedSecretTraceRegistry([], scope)
  for (const item of provenance) {
    await importDurableSecretProvenance(registry, item.provenance, item.data, 'memory', {
      reportUnrecorded: false,
    })
  }
  const envelope = serializePrivateToolMetadataResponseEnvelope(
    body,
    RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    registry.exportCommittedProvenanceForValue(body)
  )
  return Response.json(envelope.body, { headers: envelope.headers })
}
