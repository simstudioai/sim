import {
  PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
  PRIVATE_SECRET_PROVENANCE_FIELD,
  PRIVATE_SECRET_PROVENANCE_HEADER,
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import {
  isResolvedSecretTraceProvenanceV1,
  type ResolvedSecretTraceProvenanceV1,
  type ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

export const PRIVATE_MODEL_INPUT_PROVENANCE_HEADER = 'x-sim-private-model-input-provenance'
export const OPAQUE_MODEL_INPUT_PROVENANCE_UNAVAILABLE_ERROR =
  'Model input provenance is unavailable'
export const OPAQUE_MODEL_INPUT_RESOLVED_SECRET_ERROR =
  'Model input contains a resolved secret that cannot be safely projected'

const MAX_PRIVATE_SECRET_PROVENANCE_SELECTIONS = 10_000
const MAX_PRIVATE_SECRET_PROVENANCE_BYTES = 8 * 1024 * 1024

interface HeaderReader {
  get(name: string): string | null
}

export type ModelInputProvenanceInspection =
  | { status: 'verified'; value: unknown }
  | { status: 'unsupported' }
  | { status: 'invalid' }

export type OpaqueModelInputProvenanceValidation =
  | { success: true }
  | { success: false; error: string; status: 400 }

export interface ModelInputProvenanceRequestMetadata {
  provenance: ResolvedSecretTraceProvenanceV1
  headerName: typeof PRIVATE_MODEL_INPUT_PROVENANCE_HEADER
  headerValue: typeof RESOLVED_SECRET_PROVENANCE_METADATA_V1
  fieldName: typeof RESOLVED_SECRET_PROVENANCE_FIELD
}

export interface PrivateSecretProvenanceSelection {
  key: string
  value: unknown
}

export interface PrivateSecretProvenanceBundleV1 {
  version: 1
  complete: boolean
  selections: Array<{ key: string; provenance: ResolvedSecretTraceProvenanceV1 }>
}

export interface PrivateSecretProvenanceRequestMetadata {
  provenance: PrivateSecretProvenanceBundleV1
  headerName: typeof PRIVATE_SECRET_PROVENANCE_HEADER
  headerValue: typeof PRIVATE_SECRET_PROVENANCE_BUNDLE_V1
  fieldName: typeof PRIVATE_SECRET_PROVENANCE_FIELD
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

/** Builds generic private metadata from committed secrets in one selected boundary value. */
export function createPrivateSecretProvenanceRequestMetadata(
  registry: ResolvedSecretTraceRegistry | undefined,
  selections: readonly PrivateSecretProvenanceSelection[]
): PrivateSecretProvenanceRequestMetadata | undefined {
  if (!registry) return undefined

  const keys = new Set<string>()
  let complete = selections.length <= MAX_PRIVATE_SECRET_PROVENANCE_SELECTIONS
  const provenanceSelections: PrivateSecretProvenanceBundleV1['selections'] = []
  if (complete) {
    for (const selection of selections) {
      if (!selection.key || keys.has(selection.key)) {
        complete = false
        break
      }
      keys.add(selection.key)
      const provenance = registry.exportCommittedProvenanceForValue(selection.value)
      if (!provenance.complete) {
        complete = false
        break
      }
      provenanceSelections.push({ key: selection.key, provenance })
    }
  }

  const bundle: PrivateSecretProvenanceBundleV1 = {
    version: 1,
    complete,
    selections: complete ? provenanceSelections : [],
  }
  if (Buffer.byteLength(JSON.stringify(bundle), 'utf8') > MAX_PRIVATE_SECRET_PROVENANCE_BYTES) {
    bundle.complete = false
    bundle.selections = []
  }
  return {
    provenance: bundle,
    headerName: PRIVATE_SECRET_PROVENANCE_HEADER,
    headerValue: PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
    fieldName: PRIVATE_SECRET_PROVENANCE_FIELD,
  }
}

/** Adds one private provenance envelope to an internal JSON request. */
export function addModelInputProvenanceToRequest(
  payload: Record<string, unknown>,
  headers: Headers,
  metadata: ModelInputProvenanceRequestMetadata | PrivateSecretProvenanceRequestMetadata | undefined
): Record<string, unknown> {
  if (!metadata) return payload
  if (Object.hasOwn(payload, metadata.fieldName)) {
    throw new Error('Model input provenance request body is invalid')
  }

  headers.set(metadata.headerName, metadata.headerValue)
  return { ...payload, [metadata.fieldName]: metadata.provenance }
}

export function isPrivateSecretProvenanceBundleV1(
  value: unknown
): value is PrivateSecretProvenanceBundleV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const bundle = value as Record<string, unknown>
  if (
    bundle.version !== 1 ||
    typeof bundle.complete !== 'boolean' ||
    !Array.isArray(bundle.selections) ||
    bundle.selections.length > MAX_PRIVATE_SECRET_PROVENANCE_SELECTIONS ||
    (!bundle.complete && bundle.selections.length > 0)
  ) {
    return false
  }
  const keys = new Set<string>()
  for (const selection of bundle.selections) {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) return false
    const record = selection as Record<string, unknown>
    if (
      typeof record.key !== 'string' ||
      record.key.length === 0 ||
      keys.has(record.key) ||
      !isResolvedSecretTraceProvenanceV1(record.provenance)
    ) {
      return false
    }
    keys.add(record.key)
  }
  return Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_PRIVATE_SECRET_PROVENANCE_BYTES
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

/** Validates the generic private request marker and encrypted provenance envelope. */
export function inspectPrivateSecretProvenanceRequest(
  headers: HeaderReader,
  payload: unknown
): ModelInputProvenanceInspection {
  const record =
    payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : undefined
  const hasProvenance = record ? Object.hasOwn(record, PRIVATE_SECRET_PROVENANCE_FIELD) : false
  const receivedType = headers.get(PRIVATE_SECRET_PROVENANCE_HEADER)

  if (receivedType === null && !hasProvenance) return { status: 'unsupported' }
  if (receivedType !== PRIVATE_SECRET_PROVENANCE_BUNDLE_V1 || !record || !hasProvenance) {
    return { status: 'invalid' }
  }
  return { status: 'verified', value: record[PRIVATE_SECRET_PROVENANCE_FIELD] }
}

/**
 * Validates model-bound inputs that cannot be rewritten safely, such as file bytes and signed
 * URLs. External headerless calls retain their existing behavior. Internal callers must use the
 * authenticated envelope unless a compatibility route explicitly opts into its pre-envelope
 * protocol. Incomplete, malformed, or secret-bearing envelopes always fail closed.
 */
export function validateOpaqueModelInputProvenance(options: {
  headers: HeaderReader
  payload: unknown
  isInternalRequest: boolean
  allowLegacyWithoutEnvelope?: boolean
}): OpaqueModelInputProvenanceValidation {
  const inspection = inspectModelInputProvenanceRequest(options.headers, options.payload)
  if (inspection.status === 'unsupported') {
    return options.isInternalRequest && !options.allowLegacyWithoutEnvelope
      ? {
          success: false,
          error: OPAQUE_MODEL_INPUT_PROVENANCE_UNAVAILABLE_ERROR,
          status: 400,
        }
      : { success: true }
  }
  if (inspection.status === 'invalid' || !options.isInternalRequest) {
    return { success: false, error: 'Invalid model input provenance', status: 400 }
  }
  if (!isResolvedSecretTraceProvenanceV1(inspection.value) || !inspection.value.complete) {
    return {
      success: false,
      error: OPAQUE_MODEL_INPUT_PROVENANCE_UNAVAILABLE_ERROR,
      status: 400,
    }
  }
  if (inspection.value.entries.length > 0) {
    return {
      success: false,
      error: OPAQUE_MODEL_INPUT_RESOLVED_SECRET_ERROR,
      status: 400,
    }
  }
  return { success: true }
}
