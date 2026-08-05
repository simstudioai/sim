export const PRIVATE_TOOL_METADATA_REQUEST_HEADER = 'x-sim-request-private-tool-metadata'
export const PRIVATE_TOOL_METADATA_RESPONSE_HEADER = 'x-sim-private-tool-metadata'

export const RESOLVED_SECRET_NAMES_METADATA_V1 = 'resolved-secret-names-v1'
export const RESOLVED_SECRET_NAMES_DURABLE_FILES_METADATA_V2 =
  'resolved-secret-names-durable-files-v2'
export const RESOLVED_SECRET_PROVENANCE_METADATA_V1 = 'resolved-secret-provenance-v1'

export const RESOLVED_SECRET_NAMES_FIELD = '__resolvedSecretNames'
export const RESOLVED_SECRET_PROVENANCE_FIELD = '__resolvedSecretTraceProvenance'

export type PrivateToolMetadataType =
  | typeof RESOLVED_SECRET_NAMES_METADATA_V1
  | typeof RESOLVED_SECRET_NAMES_DURABLE_FILES_METADATA_V2
  | typeof RESOLVED_SECRET_PROVENANCE_METADATA_V1

export type PrivateToolMetadataResponseCapability =
  | { status: 'supported' }
  | { status: 'unsupported' }
  | { status: 'mismatched'; receivedType: string }

export type PrivateToolMetadataEnvelopeInspection =
  | { status: 'verified'; value: unknown }
  | { status: 'unsupported' }
  | { status: 'invalid' }

interface HeaderReader {
  get(name: string): string | null
}

export function isPrivateToolMetadataType(value: string | null): value is PrivateToolMetadataType {
  return (
    value === RESOLVED_SECRET_NAMES_METADATA_V1 ||
    value === RESOLVED_SECRET_NAMES_DURABLE_FILES_METADATA_V2 ||
    value === RESOLVED_SECRET_PROVENANCE_METADATA_V1
  )
}

export function requestsPrivateToolMetadata(
  headers: HeaderReader,
  expectedType: PrivateToolMetadataType
): boolean {
  return headers.get(PRIVATE_TOOL_METADATA_REQUEST_HEADER) === expectedType
}

export function responseHasPrivateToolMetadata(
  headers: HeaderReader,
  expectedType: PrivateToolMetadataType
): boolean {
  return headers.get(PRIVATE_TOOL_METADATA_RESPONSE_HEADER) === expectedType
}

/**
 * Distinguishes a legacy producer from a producer that declared an incompatible protocol.
 * Callers can reject one unsupported response without corrupting otherwise valid run state.
 */
export function inspectPrivateToolMetadataResponseCapability(
  headers: HeaderReader,
  expectedType: PrivateToolMetadataType
): PrivateToolMetadataResponseCapability {
  const receivedType = headers.get(PRIVATE_TOOL_METADATA_RESPONSE_HEADER)
  if (receivedType === expectedType) return { status: 'supported' }
  if (receivedType === null) return { status: 'unsupported' }
  return { status: 'mismatched', receivedType }
}

export function getPrivateToolMetadataField(
  type: PrivateToolMetadataType
): typeof RESOLVED_SECRET_NAMES_FIELD | typeof RESOLVED_SECRET_PROVENANCE_FIELD {
  return type === RESOLVED_SECRET_NAMES_METADATA_V1 ||
    type === RESOLVED_SECRET_NAMES_DURABLE_FILES_METADATA_V2
    ? RESOLVED_SECRET_NAMES_FIELD
    : RESOLVED_SECRET_PROVENANCE_FIELD
}

/**
 * Validates the response capability marker and its private payload as one protocol envelope.
 * An unmarked payload with no private fields is a legacy response; every partial or mismatched
 * envelope is invalid and must never be exposed as functional content.
 */
export function inspectPrivateToolMetadataEnvelope(
  headers: HeaderReader,
  payload: unknown,
  expectedType: PrivateToolMetadataType
): PrivateToolMetadataEnvelopeInspection {
  const capability = inspectPrivateToolMetadataResponseCapability(headers, expectedType)
  const record =
    payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : undefined
  const hasNames = record ? Object.hasOwn(record, RESOLVED_SECRET_NAMES_FIELD) : false
  const hasProvenance = record ? Object.hasOwn(record, RESOLVED_SECRET_PROVENANCE_FIELD) : false

  if (capability.status === 'unsupported' && !hasNames && !hasProvenance) {
    return { status: 'unsupported' }
  }
  if (capability.status !== 'supported' || !record) return { status: 'invalid' }

  const expectedField = getPrivateToolMetadataField(expectedType)
  const unexpectedField =
    expectedField === RESOLVED_SECRET_NAMES_FIELD
      ? RESOLVED_SECRET_PROVENANCE_FIELD
      : RESOLVED_SECRET_NAMES_FIELD
  if (!Object.hasOwn(record, expectedField) || Object.hasOwn(record, unexpectedField)) {
    return { status: 'invalid' }
  }

  return { status: 'verified', value: record[expectedField] }
}
