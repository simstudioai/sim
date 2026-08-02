export const PRIVATE_TOOL_METADATA_REQUEST_HEADER = 'x-sim-request-private-tool-metadata'
export const PRIVATE_TOOL_METADATA_RESPONSE_HEADER = 'x-sim-private-tool-metadata'

export const RESOLVED_SECRET_NAMES_METADATA_V1 = 'resolved-secret-names-v1'
export const RESOLVED_SECRET_PROVENANCE_METADATA_V1 = 'resolved-secret-provenance-v1'

export const RESOLVED_SECRET_NAMES_FIELD = '__resolvedSecretNames'
export const RESOLVED_SECRET_PROVENANCE_FIELD = '__resolvedSecretTraceProvenance'

export type PrivateToolMetadataType =
  | typeof RESOLVED_SECRET_NAMES_METADATA_V1
  | typeof RESOLVED_SECRET_PROVENANCE_METADATA_V1

interface HeaderReader {
  get(name: string): string | null
}

export function isPrivateToolMetadataType(value: string | null): value is PrivateToolMetadataType {
  return (
    value === RESOLVED_SECRET_NAMES_METADATA_V1 || value === RESOLVED_SECRET_PROVENANCE_METADATA_V1
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

export function getPrivateToolMetadataField(
  type: PrivateToolMetadataType
): typeof RESOLVED_SECRET_NAMES_FIELD | typeof RESOLVED_SECRET_PROVENANCE_FIELD {
  return type === RESOLVED_SECRET_NAMES_METADATA_V1
    ? RESOLVED_SECRET_NAMES_FIELD
    : RESOLVED_SECRET_PROVENANCE_FIELD
}
