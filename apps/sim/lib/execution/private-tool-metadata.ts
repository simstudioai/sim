import { isRecordLike } from '@sim/utils/object'
export const PRIVATE_TOOL_METADATA_REQUEST_HEADER = 'x-sim-request-private-tool-metadata'
export const PRIVATE_TOOL_METADATA_RESPONSE_HEADER = 'x-sim-private-tool-metadata'
export const MAX_PRIVATE_TOOL_METADATA_OVERHEAD_BYTES = 10 * 1024 * 1024

export const RESOLVED_SECRET_NAMES_METADATA_V1 = 'resolved-secret-names-v1'
export const RESOLVED_SECRET_NAMES_DURABLE_FILES_METADATA_V2 =
  'resolved-secret-names-durable-files-v2'
export const RESOLVED_SECRET_PROVENANCE_METADATA_V1 = 'resolved-secret-provenance-v1'

export const RESOLVED_SECRET_NAMES_FIELD = '__resolvedSecretNames'
export const RESOLVED_SECRET_PROVENANCE_FIELD = '__resolvedSecretTraceProvenance'
export const PRIVATE_SECRET_PROVENANCE_HEADER = 'x-sim-private-secret-provenance'
export const PRIVATE_SECRET_PROVENANCE_FIELD = '__privateSecretProvenance'
export const PRIVATE_SECRET_PROVENANCE_BUNDLE_V1 = 'private-secret-provenance-bundle-v1'
export const MOUNTED_WORKSPACE_FILES_PROVENANCE_KEY = 'mounted-workspace-files'

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

type PrivateToolMetadataResponseNegotiation =
  | { status: 'not-requested' }
  | { status: 'accepted' }
  | { status: 'rejected' }

interface PrivateToolMetadataResponseEnvelope {
  body: Record<string, unknown>
  headers: Record<typeof PRIVATE_TOOL_METADATA_RESPONSE_HEADER, PrivateToolMetadataType>
}

interface HeaderReader {
  get(name: string): string | null
}

export function requestsPrivateToolMetadata(
  headers: HeaderReader,
  expectedType: PrivateToolMetadataType
): boolean {
  return headers.get(PRIVATE_TOOL_METADATA_REQUEST_HEADER) === expectedType
}

/** Negotiates an authenticated private response without loading domain provenance. */
export function negotiatePrivateToolMetadataResponse(
  headers: HeaderReader,
  expectedType: PrivateToolMetadataType,
  authenticated: boolean
): PrivateToolMetadataResponseNegotiation {
  const requestedType = headers.get(PRIVATE_TOOL_METADATA_REQUEST_HEADER)
  if (requestedType === null) return { status: 'not-requested' }
  return requestedType === expectedType && authenticated
    ? { status: 'accepted' }
    : { status: 'rejected' }
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

function getPrivateToolMetadataField(
  type: PrivateToolMetadataType
): typeof RESOLVED_SECRET_NAMES_FIELD | typeof RESOLVED_SECRET_PROVENANCE_FIELD {
  return type === RESOLVED_SECRET_NAMES_METADATA_V1 ||
    type === RESOLVED_SECRET_NAMES_DURABLE_FILES_METADATA_V2
    ? RESOLVED_SECRET_NAMES_FIELD
    : RESOLVED_SECRET_PROVENANCE_FIELD
}

/** Serializes private metadata without changing the functional response fields. */
export function serializePrivateToolMetadataResponseEnvelope(
  body: Record<string, unknown>,
  type: PrivateToolMetadataType,
  value: unknown
): PrivateToolMetadataResponseEnvelope {
  return {
    body: { ...body, [getPrivateToolMetadataField(type)]: value },
    headers: { [PRIVATE_TOOL_METADATA_RESPONSE_HEADER]: type },
  }
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
  const record = isRecordLike(payload) ? (payload as Record<string, unknown>) : undefined
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
