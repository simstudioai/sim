import { createLogger } from '@sim/logger'
import { isPlainRecord, isRecordLike } from '@sim/utils/object'
import {
  PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
  PRIVATE_SECRET_PROVENANCE_FIELD,
  PRIVATE_SECRET_PROVENANCE_HEADER,
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import { PROVENANCE_MAX_SERIALIZED_BYTES } from '@/lib/execution/provenance-limits'
import {
  isResolvedSecretTraceProvenanceV1,
  type ResolvedSecretInputPath,
  type ResolvedSecretTraceProvenanceV1,
  type ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

export const PRIVATE_MODEL_INPUT_PROVENANCE_HEADER = 'x-sim-private-model-input-provenance'
export const PRIVATE_MODEL_INPUT_STATE_HEADER = 'x-sim-private-model-input-state'
export const PROJECTED_MODEL_INPUT_PATHS_V1 = 'projected-input-paths-v1'
export const OPAQUE_MODEL_INPUT_PROVENANCE_UNAVAILABLE_ERROR =
  'Model input provenance is unavailable'
export const OPAQUE_MODEL_INPUT_RESOLVED_SECRET_ERROR =
  'Model input contains a resolved secret that cannot be safely projected'

const logger = createLogger('ModelInputProvenance')

/**
 * Ceiling on the serialized envelope, not on how much a caller may vouch for.
 *
 * A selection count cap used to sit beside this one. It was reachable by an ordinary write — a
 * 25-column table insert crossed it at 401 rows — and crossing it failed the entire bundle, so
 * every row of the write landed `unknown` in its durable sidecar. It existed to bound a per-group
 * rescan in the registry that is now a single indexed pass, so there is nothing left for a count
 * to protect. This bound stays because a request body is a real transport limit.
 */

/**
 * Why a bundle could not vouch for the cells one write touched.
 *
 * A closed union rather than a free-form string, for the reason the resolved-secret registry's
 * reason set is one: an incomplete bundle stamps every row of the write `unknown` in its durable
 * sidecar, and a cause a call site can spell freely cannot be aggregated or alerted on.
 */
export type PrivateSecretProvenanceBundleFailure =
  | 'selection-key-invalid'
  | 'registry-incomplete'
  | 'bundle-oversized'

interface HeaderReader {
  get(name: string): string | null
}

interface HeaderWriter {
  set(name: string, value: string): void
}

export type ModelInputProvenanceInspection =
  | { status: 'verified'; value: unknown }
  | { status: 'unsupported' }
  | { status: 'invalid' }

export type ModelInputProjectionState = 'unmarked' | 'projected' | 'invalid'

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
  inputPaths: readonly ResolvedSecretInputPath[]
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

export type ResolvedModelInputProjection<T extends Record<string, unknown>> =
  | {
      complete: true
      value: T
      registry?: ResolvedSecretTraceRegistry
    }
  | { complete: false }

const MODEL_SCHEMA_ANNOTATION_KEYS = new Set([
  '$comment',
  'description',
  'example',
  'examples',
  'title',
])
const MODEL_SCHEMA_MAP_KEYS = new Set([
  '$defs',
  'definitions',
  'dependentSchemas',
  'patternProperties',
  'properties',
])
const MODEL_SCHEMA_SINGLE_KEYS = new Set([
  'additionalItems',
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
])
const MODEL_SCHEMA_ARRAY_KEYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])

export interface ModelSchemaInputPathSelection {
  annotationInputPaths: ResolvedSecretInputPath[]
  semanticInputPaths: ResolvedSecretInputPath[]
}

export type ModelSchemaProjection = { safe: true; value: unknown } | { safe: false }

function haveSameRecordKeys(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.hasOwn(right, key))
}

function areSchemaValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => areSchemaValuesEqual(value, right[index]))
    )
  }
  if (!isPlainRecord(left) || !isPlainRecord(right) || !haveSameRecordKeys(left, right)) {
    return false
  }
  return Object.keys(left).every((key) => areSchemaValuesEqual(left[key], right[key]))
}

function selectSchemaMapInputPaths(
  value: unknown,
  path: ResolvedSecretInputPath,
  visitSchema: (schema: unknown, path: ResolvedSecretInputPath) => void,
  semanticInputPaths: ResolvedSecretInputPath[]
): void {
  if (!isPlainRecord(value)) {
    semanticInputPaths.push(path)
    return
  }
  for (const [name, childSchema] of Object.entries(value)) {
    visitSchema(childSchema, [...path, name])
  }
}

/** Selects JSON Schema annotations separately from fields that define its contract. */
export function selectModelSchemaInputPaths(
  schema: unknown,
  rootPath: ResolvedSecretInputPath
): ModelSchemaInputPathSelection {
  const annotationInputPaths: ResolvedSecretInputPath[] = []
  const semanticInputPaths: ResolvedSecretInputPath[] = []

  const visitSchema = (value: unknown, path: ResolvedSecretInputPath): void => {
    if (!isPlainRecord(value)) {
      semanticInputPaths.push(path)
      return
    }

    for (const [key, keywordValue] of Object.entries(value)) {
      const keywordPath = [...path, key]
      if (MODEL_SCHEMA_ANNOTATION_KEYS.has(key)) {
        annotationInputPaths.push(keywordPath)
        continue
      }
      if (MODEL_SCHEMA_MAP_KEYS.has(key)) {
        selectSchemaMapInputPaths(keywordValue, keywordPath, visitSchema, semanticInputPaths)
        continue
      }
      if (MODEL_SCHEMA_ARRAY_KEYS.has(key)) {
        if (!Array.isArray(keywordValue)) {
          semanticInputPaths.push(keywordPath)
          continue
        }
        keywordValue.forEach((childSchema, index) =>
          visitSchema(childSchema, [...keywordPath, String(index)])
        )
        continue
      }
      if (MODEL_SCHEMA_SINGLE_KEYS.has(key)) {
        if (key === 'items' && Array.isArray(keywordValue)) {
          keywordValue.forEach((childSchema, index) =>
            visitSchema(childSchema, [...keywordPath, String(index)])
          )
        } else {
          visitSchema(keywordValue, keywordPath)
        }
        continue
      }
      if (key === 'dependencies' && isPlainRecord(keywordValue)) {
        for (const [name, dependency] of Object.entries(keywordValue)) {
          const dependencyPath = [...keywordPath, name]
          if (Array.isArray(dependency)) semanticInputPaths.push(dependencyPath)
          else visitSchema(dependency, dependencyPath)
        }
        continue
      }
      semanticInputPaths.push(keywordPath)
    }
  }

  visitSchema(schema, rootPath)
  return { annotationInputPaths, semanticInputPaths }
}

function projectSchemaArray(rawValue: unknown, projectedValue: unknown): ModelSchemaProjection {
  if (
    !Array.isArray(rawValue) ||
    !Array.isArray(projectedValue) ||
    rawValue.length !== projectedValue.length
  ) {
    return { safe: false }
  }
  const value: unknown[] = []
  for (let index = 0; index < rawValue.length; index++) {
    const child = projectModelSchemaAnnotations(rawValue[index], projectedValue[index])
    if (!child.safe) return child
    value.push(child.value)
  }
  return { safe: true, value }
}

function projectSchemaMap(rawValue: unknown, projectedValue: unknown): ModelSchemaProjection {
  if (
    !isPlainRecord(rawValue) ||
    !isPlainRecord(projectedValue) ||
    !haveSameRecordKeys(rawValue, projectedValue)
  ) {
    return { safe: false }
  }
  const value: Record<string, unknown> = {}
  for (const key of Object.keys(rawValue)) {
    const child = projectModelSchemaAnnotations(rawValue[key], projectedValue[key])
    if (!child.safe) return child
    value[key] = child.value
  }
  return { safe: true, value }
}

function projectSchemaDependencies(
  rawValue: unknown,
  projectedValue: unknown
): ModelSchemaProjection {
  if (
    !isPlainRecord(rawValue) ||
    !isPlainRecord(projectedValue) ||
    !haveSameRecordKeys(rawValue, projectedValue)
  ) {
    return areSchemaValuesEqual(rawValue, projectedValue)
      ? { safe: true, value: rawValue }
      : { safe: false }
  }
  const value: Record<string, unknown> = {}
  for (const key of Object.keys(rawValue)) {
    const rawDependency = rawValue[key]
    const projectedDependency = projectedValue[key]
    if (Array.isArray(rawDependency)) {
      if (!areSchemaValuesEqual(rawDependency, projectedDependency)) return { safe: false }
      value[key] = rawDependency
      continue
    }
    const child = projectModelSchemaAnnotations(rawDependency, projectedDependency)
    if (!child.safe) return child
    value[key] = child.value
  }
  return { safe: true, value }
}

/** Applies exact projections only to annotations while preserving schema contract fields. */
export function projectModelSchemaAnnotations(
  rawValue: unknown,
  projectedValue: unknown
): ModelSchemaProjection {
  if (Object.is(rawValue, projectedValue)) return { safe: true, value: rawValue }
  if (!isPlainRecord(rawValue) || !isPlainRecord(projectedValue)) return { safe: false }
  if (!haveSameRecordKeys(rawValue, projectedValue)) return { safe: false }

  const value: Record<string, unknown> = {}
  for (const key of Object.keys(rawValue)) {
    const rawKeyword = rawValue[key]
    const projectedKeyword = projectedValue[key]
    if (MODEL_SCHEMA_ANNOTATION_KEYS.has(key)) {
      value[key] = projectedKeyword
      continue
    }
    if (MODEL_SCHEMA_MAP_KEYS.has(key)) {
      const child = projectSchemaMap(rawKeyword, projectedKeyword)
      if (!child.safe) return child
      value[key] = child.value
      continue
    }
    if (MODEL_SCHEMA_ARRAY_KEYS.has(key)) {
      const child = projectSchemaArray(rawKeyword, projectedKeyword)
      if (!child.safe) return child
      value[key] = child.value
      continue
    }
    if (MODEL_SCHEMA_SINGLE_KEYS.has(key)) {
      const child =
        key === 'items' && Array.isArray(rawKeyword)
          ? projectSchemaArray(rawKeyword, projectedKeyword)
          : projectModelSchemaAnnotations(rawKeyword, projectedKeyword)
      if (!child.safe) return child
      value[key] = child.value
      continue
    }
    if (key === 'dependencies') {
      const child = projectSchemaDependencies(rawKeyword, projectedKeyword)
      if (!child.safe) return child
      value[key] = child.value
      continue
    }
    if (!areSchemaValuesEqual(rawKeyword, projectedKeyword)) return { safe: false }
    value[key] = rawKeyword
  }
  return { safe: true, value }
}

/**
 * Builds a model-facing copy from resolver-recorded leaves only.
 *
 * The selected record must retain the same top-level keys and nested paths as the block inputs
 * that passed through `VariableResolver`. No plaintext matching is performed here.
 */
export function projectResolvedModelInput<T extends Record<string, unknown>>(
  registry: ResolvedSecretTraceRegistry | undefined,
  selected: T,
  inputPaths: readonly ResolvedSecretInputPath[]
): ResolvedModelInputProjection<T> {
  if (!registry) return { complete: true, value: selected }

  const modelRegistry = registry.forkForInputPaths(inputPaths)
  const projection = modelRegistry.projectResolvedInputSelection(selected)
  if (!projection.complete) return { complete: false }
  return {
    complete: true,
    value: projection.value as T,
    registry: modelRegistry,
  }
}

/** Builds private metadata from only resolver-recorded paths selected for this model request. */
export function createModelInputProvenanceRequestMetadata(
  registry: ResolvedSecretTraceRegistry | undefined,
  inputPaths: readonly ResolvedSecretInputPath[]
): ModelInputProvenanceRequestMetadata | undefined {
  if (!registry) return undefined

  return {
    provenance: registry.exportCommittedProvenanceForInputPaths(inputPaths),
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
  let failure: PrivateSecretProvenanceBundleFailure | undefined
  const provenanceSelections: PrivateSecretProvenanceBundleV1['selections'] = []
  for (const selection of selections) {
    if (!selection.key || keys.has(selection.key)) {
      failure = 'selection-key-invalid'
      break
    }
    keys.add(selection.key)
  }
  if (!failure) {
    const exported = registry.exportCommittedProvenanceForInputPathGroups(
      selections.map((selection) => selection.inputPaths)
    )
    for (const [index, provenance] of exported.entries()) {
      if (!provenance.complete) {
        failure = 'registry-incomplete'
        break
      }
      provenanceSelections.push({ key: selections[index].key, provenance })
    }
  }

  const bundle: PrivateSecretProvenanceBundleV1 = {
    version: 1,
    complete: !failure,
    selections: failure ? [] : provenanceSelections,
  }
  if (Buffer.byteLength(JSON.stringify(bundle), 'utf8') > PROVENANCE_MAX_SERIALIZED_BYTES) {
    failure ??= 'bundle-oversized'
    bundle.complete = false
    bundle.selections = []
  }
  if (failure) {
    /**
     * Error, not warn, for the reason the originating-fault reasons use it: every row of this
     * write lands `unknown` in a durable sidecar, a durable surface stays open on the strength of
     * this line trending to zero, and error is the only level surviving every default the logger
     * falls back to.
     */
    logger.error('Private secret provenance bundle is incomplete', {
      failure,
      selectionCount: selections.length,
      ...(registry.getIncompletenessDiagnostics() ?? {}),
    })
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

/** Marks an authenticated private-provenance request whose selected inputs were projected. */
export function markModelInputProjected(headers: HeaderWriter): void {
  headers.set(PRIVATE_MODEL_INPUT_STATE_HEADER, PROJECTED_MODEL_INPUT_PATHS_V1)
}

/** Reads the additive projection state without changing the existing v1 envelope protocol. */
export function inspectModelInputProjectionState(headers: HeaderReader): ModelInputProjectionState {
  const state = headers.get(PRIVATE_MODEL_INPUT_STATE_HEADER)
  if (state === null) return 'unmarked'
  return state === PROJECTED_MODEL_INPUT_PATHS_V1 ? 'projected' : 'invalid'
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
  return Buffer.byteLength(JSON.stringify(value), 'utf8') <= PROVENANCE_MAX_SERIALIZED_BYTES
}

/**
 * Validates the private request marker and payload as one envelope. Headerless requests are the
 * legacy protocol only when they also contain no private field; every partial envelope is invalid.
 */
export function inspectModelInputProvenanceRequest(
  headers: HeaderReader,
  payload: unknown
): ModelInputProvenanceInspection {
  const record = isRecordLike(payload) ? (payload as Record<string, unknown>) : undefined
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
  const record = isRecordLike(payload) ? (payload as Record<string, unknown>) : undefined
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
 * URLs. A missing envelope is the additive legacy protocol for both external and internal calls.
 * Once either half of the private protocol is present, incomplete, malformed, forged, or
 * secret-bearing envelopes fail closed.
 */
export function validateOpaqueModelInputProvenance(options: {
  headers: HeaderReader
  payload: unknown
  isInternalRequest: boolean
}): OpaqueModelInputProvenanceValidation {
  const inspection = inspectModelInputProvenanceRequest(options.headers, options.payload)
  if (inspection.status === 'unsupported') return { success: true }
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
