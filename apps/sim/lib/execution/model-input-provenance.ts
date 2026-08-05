import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import type {
  ResolvedSecretTraceProvenanceV1,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

export const PRIVATE_MODEL_INPUT_PROVENANCE_HEADER = 'x-sim-private-model-input-provenance'

interface HeaderReader {
  get(name: string): string | null
}

export type ModelInputProvenanceInspection =
  | { status: 'verified'; value: unknown }
  | { status: 'unsupported' }
  | { status: 'invalid' }

export interface ModelInputProvenanceRequestMetadata {
  provenance: ResolvedSecretTraceProvenanceV1
  headerName: typeof PRIVATE_MODEL_INPUT_PROVENANCE_HEADER
  headerValue: typeof RESOLVED_SECRET_PROVENANCE_METADATA_V1
  fieldName: typeof RESOLVED_SECRET_PROVENANCE_FIELD
}

/** Builds private metadata from only committed secrets present in this model-bound value. */
export function createModelInputProvenanceRequestMetadata(
  registry: ResolvedSecretTraceRegistry | undefined,
  modelInput: unknown
): ModelInputProvenanceRequestMetadata | undefined {
  if (!registry) return undefined

  return {
    provenance: registry.exportCommittedProvenanceForValue(modelInput),
    headerName: PRIVATE_MODEL_INPUT_PROVENANCE_HEADER,
    headerValue: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    fieldName: RESOLVED_SECRET_PROVENANCE_FIELD,
  }
}

/** Adds one private provenance envelope to an internal JSON request. */
export function addModelInputProvenanceToRequest(
  payload: Record<string, unknown>,
  headers: Headers,
  metadata: ModelInputProvenanceRequestMetadata | undefined
): Record<string, unknown> {
  if (!metadata) return payload
  if (Object.hasOwn(payload, metadata.fieldName)) {
    throw new Error('Model input provenance request body is invalid')
  }

  headers.set(metadata.headerName, metadata.headerValue)
  return { ...payload, [metadata.fieldName]: metadata.provenance }
}

/**
 * Compatibility path for callers predating the private capability. It scans only the exact
 * model-bound value selected by the receiving boundary, never the surrounding transport body.
 */
export async function reconstructLegacyModelInputProvenance(
  registry: ResolvedSecretTraceRegistry,
  modelInput: unknown
): Promise<boolean> {
  const provenance = registry.exportModelEgressProvenanceForValue(modelInput)
  if (!provenance.complete) {
    registry.markIncomplete()
    return false
  }
  return registry.importProvenance(provenance, { trusted: true })
}

/**
 * Validates the private request marker and payload as one envelope. Headerless requests are the
 * legacy protocol only when they also contain no private field; every partial envelope is invalid.
 */
export function inspectModelInputProvenanceRequest(
  headers: HeaderReader,
  payload: unknown
): ModelInputProvenanceInspection {
  const record =
    payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : undefined
  const hasProvenance = record ? Object.hasOwn(record, RESOLVED_SECRET_PROVENANCE_FIELD) : false
  const receivedType = headers.get(PRIVATE_MODEL_INPUT_PROVENANCE_HEADER)

  if (receivedType === null && !hasProvenance) return { status: 'unsupported' }
  if (receivedType !== RESOLVED_SECRET_PROVENANCE_METADATA_V1 || !record || !hasProvenance) {
    return { status: 'invalid' }
  }

  return { status: 'verified', value: record[RESOLVED_SECRET_PROVENANCE_FIELD] }
}
