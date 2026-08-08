import { isDeepStrictEqual } from 'node:util'
import { isPlainRecord } from '@sim/utils/object'
import { LARGE_ARRAY_MANIFEST_MARKER } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { LARGE_VALUE_REF_MARKER } from '@/lib/execution/payloads/large-value-ref'
import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'
import {
  containsResolvedSecret,
  containsResolvedSecretLiteral,
  createResolvedSecretMatcher,
  OPAQUE_RESOLVED_SECRET_REPLACEMENT,
  type ResolvedSecretMatch,
  type ResolvedSecretMatcher,
  sanitizeResolvedSecretPrimitive,
  sanitizeResolvedSecretString,
} from '@/executor/utils/resolved-secret-matcher'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

export {
  containsResolvedSecret,
  createResolvedSecretMatcher,
  type ResolvedSecretMatcher,
  sanitizeResolvedSecretString,
  scanResolvedSecretString,
} from '@/executor/utils/resolved-secret-matcher'

const MAX_CONTENT_NODES = 100_000
const MAX_CONTENT_DEPTH = 100
const INTERNAL_DIAGNOSTIC_IDENTIFIER_PATTERN =
  /__var_[A-Za-z0-9_]+|__sim_code_\d+_(?:binding|input|runtime)_\d+[A-Za-z0-9_]*|__sim_placeholder_[a-f0-9]{64}__|__sim_runtime_[A-Za-z0-9_]+_\d+[A-Za-z0-9_]*|__SIM_RUNTIME_PAYLOAD_PATH/g

const modelEgressMatcherCache = new WeakMap<
  ResolvedSecretTraceRegistry,
  { revision: number; complete: boolean; matcher?: ResolvedSecretMatcher }
>()

function createResolvedSecretModelMatcher(
  matches: readonly ResolvedSecretMatch[]
): ResolvedSecretMatcher | undefined {
  const matcher = createResolvedSecretMatcher(matches, {
    preserveNamedProvenanceLabels: true,
  })
  if (!matcher) return undefined

  const originalReplacementByPlaintext = new Map<string, string>()
  for (const { plaintext, replacement } of matches) {
    const current = originalReplacementByPlaintext.get(plaintext)
    if (current === undefined || replacement < current) {
      originalReplacementByPlaintext.set(plaintext, replacement)
    }
  }

  const opaquePlaceholderMatches: ResolvedSecretMatch[] = []
  for (const [plaintext, replacement] of matcher.exactReplacements) {
    if (replacement !== OPAQUE_RESOLVED_SECRET_REPLACEMENT) continue
    opaquePlaceholderMatches.push({
      plaintext: `{{${plaintext}}}`,
      replacement: OPAQUE_RESOLVED_SECRET_REPLACEMENT,
    })
    const originalReplacement = originalReplacementByPlaintext.get(plaintext)
    if (originalReplacement && /^\{\{[^{}]+\}\}$/.test(originalReplacement)) {
      opaquePlaceholderMatches.push({
        plaintext: originalReplacement,
        replacement: OPAQUE_RESOLVED_SECRET_REPLACEMENT,
      })
    }
  }
  if (opaquePlaceholderMatches.length === 0) return matcher

  return createResolvedSecretMatcher(
    [
      ...[...matcher.exactReplacements].map(([plaintext, replacement]) => ({
        plaintext,
        replacement,
      })),
      ...opaquePlaceholderMatches,
    ],
    { preserveNamedProvenanceLabels: true }
  )
}

export type ResolvedSecretModelMatcherSnapshot =
  | { complete: true; matcher?: ResolvedSecretMatcher }
  | { complete: false }

interface ProjectionState {
  nodes: number
  ancestors: WeakSet<object>
  outputBytes: number
  maxBytes: number
}

export interface ResolvedSecretContentProjectionOptions {
  /** Values already materialized and verified by a boundary-specific projector. */
  isOpaqueSafeObject?: (value: object) => boolean
  /** Whether string-shaped secret literals should also match typed number/boolean/null values. */
  projectPrimitiveLiterals?: boolean
  /** Whether every internal-looking identifier must be removed at a diagnostic or trace boundary. */
  sanitizeInternalIdentifiers?: boolean
  /** Receives each exact string secret detected while traversing content. */
  onMatch?: (plaintext: string) => void
  /** Rejects raw literals even when they appear inside matcher-issued provenance placeholders. */
  rejectResolvedSecretLiterals?: boolean
}

export type ResolvedSecretContentProjection = { safe: true; value: unknown } | { safe: false }

class ResolvedSecretContentProjectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResolvedSecretContentProjectionError'
  }
}

function internalDiagnosticIdentifierReplacement(identifier: string): string {
  return identifier.startsWith('__var_') ? '[REDACTED_SECRET]' : '[RUNTIME_BINDING]'
}

function sanitizeInternalDiagnosticIdentifiers(value: string): string {
  return value.replace(
    INTERNAL_DIAGNOSTIC_IDENTIFIER_PATTERN,
    internalDiagnosticIdentifierReplacement
  )
}

function sanitizeCollisionProneInternalDiagnosticIdentifiers(
  value: string,
  matcher: ResolvedSecretMatcher
): string {
  return value.replace(INTERNAL_DIAGNOSTIC_IDENTIFIER_PATTERN, (identifier) =>
    containsResolvedSecret(identifier, matcher) && !matcher.exactReplacements.has(identifier)
      ? internalDiagnosticIdentifierReplacement(identifier)
      : identifier
  )
}

function visitNode(state: ProjectionState, depth: number): void {
  state.nodes += 1
  if (state.nodes > MAX_CONTENT_NODES) {
    throw new ResolvedSecretContentProjectionError('Secret-bearing content exceeds node limit')
  }
  if (depth > MAX_CONTENT_DEPTH) {
    throw new ResolvedSecretContentProjectionError('Secret-bearing content exceeds depth limit')
  }
}

function* enumerableDataEntries(value: object): Generator<[string, unknown]> {
  const keys = Reflect.ownKeys(value)
  if (keys.length > MAX_CONTENT_NODES) {
    throw new ResolvedSecretContentProjectionError('Content object exceeds traversal limit')
  }
  for (const key of keys) {
    if (typeof key !== 'string') {
      throw new ResolvedSecretContentProjectionError('Content cannot contain symbol properties')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new ResolvedSecretContentProjectionError('Content accessors are not supported')
    }
    yield [key, descriptor.value]
  }
}

function* arrayDataEntries(value: readonly unknown[]): Generator<[number, unknown]> {
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (
    !lengthDescriptor ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number' ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    throw new ResolvedSecretContentProjectionError('Content array length is invalid')
  }

  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue
    if (typeof key !== 'string') {
      throw new ResolvedSecretContentProjectionError('Content arrays cannot contain symbols')
    }
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
      throw new ResolvedSecretContentProjectionError('Content array has custom properties')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new ResolvedSecretContentProjectionError('Content array accessors are unsupported')
    }
    yield [index, descriptor.value]
  }
}

function sanitizeContent(
  value: unknown,
  matcher: ResolvedSecretMatcher | undefined,
  state: ProjectionState,
  options: ResolvedSecretContentProjectionOptions,
  depth = 0
): unknown {
  visitNode(state, depth)
  if (typeof value === 'string') {
    const sanitized = sanitizeProjectedString(
      value,
      matcher,
      state.maxBytes - state.outputBytes,
      options
    )
    state.outputBytes += Buffer.byteLength(sanitized, 'utf8')
    return sanitized
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    if (!matcher || options.projectPrimitiveLiterals === false) return value
    const rendered = String(value)
    const sanitized = sanitizeResolvedSecretPrimitive(rendered, matcher, options.onMatch)
    if (sanitized === undefined) return value
    state.outputBytes += Buffer.byteLength(sanitized, 'utf8')
    if (state.outputBytes > state.maxBytes) {
      throw new ResolvedSecretContentProjectionError(
        'Sanitized secret-bearing primitive exceeds the size limit'
      )
    }
    return sanitized
  }
  if (value === undefined) return value
  if (typeof value !== 'object') {
    throw new ResolvedSecretContentProjectionError('Unsupported secret-bearing content value')
  }
  if (options.isOpaqueSafeObject?.(value)) return value
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    throw new ResolvedSecretContentProjectionError('Unsupported secret-bearing content value')
  }
  if (
    !Array.isArray(value) &&
    (Object.hasOwn(value, LARGE_VALUE_REF_MARKER) ||
      Object.hasOwn(value, LARGE_ARRAY_MANIFEST_MARKER))
  ) {
    throw new ResolvedSecretContentProjectionError(
      'Offloaded secret-bearing content cannot cross this boundary'
    )
  }
  if (state.ancestors.has(value)) {
    throw new ResolvedSecretContentProjectionError('Cyclic secret-bearing content is unsupported')
  }

  state.ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_CONTENT_NODES - state.nodes) {
        throw new ResolvedSecretContentProjectionError('Content array exceeds traversal limit')
      }
      const sanitized = new Array<unknown>(value.length)
      for (const [index, item] of arrayDataEntries(value)) {
        sanitized[index] = sanitizeContent(item, matcher, state, options, depth + 1)
      }
      return sanitized
    }

    const sanitized = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>
    const sanitizedKeys = new Set<string>()
    for (const [key, item] of enumerableDataEntries(value)) {
      const sanitizedKey = sanitizeProjectedString(
        key,
        matcher,
        state.maxBytes - state.outputBytes,
        options
      )
      state.outputBytes += Buffer.byteLength(sanitizedKey, 'utf8')
      if (sanitizedKeys.has(sanitizedKey)) {
        throw new ResolvedSecretContentProjectionError(
          'Secret replacement caused an object-key collision'
        )
      }
      sanitizedKeys.add(sanitizedKey)
      Object.defineProperty(sanitized, sanitizedKey, {
        value: sanitizeContent(item, matcher, state, options, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    return sanitized
  } finally {
    state.ancestors.delete(value)
  }
}

function sanitizeProjectedString(
  value: string,
  matcher: ResolvedSecretMatcher | undefined,
  maxBytes: number,
  options: ResolvedSecretContentProjectionOptions
): string {
  if (
    matcher &&
    options.rejectResolvedSecretLiterals &&
    containsResolvedSecretLiteral(value, matcher)
  ) {
    throw new ResolvedSecretContentProjectionError('Content contains a resolved secret literal')
  }
  let sanitized =
    options.sanitizeInternalIdentifiers && matcher
      ? sanitizeCollisionProneInternalDiagnosticIdentifiers(value, matcher)
      : value
  sanitized = matcher
    ? sanitizeResolvedSecretString(sanitized, matcher, maxBytes, options.onMatch)
    : sanitized
  if (options.sanitizeInternalIdentifiers) {
    sanitized = sanitizeInternalDiagnosticIdentifiers(sanitized)
  }
  if (matcher && containsResolvedSecret(sanitized, matcher)) {
    sanitized = sanitizeResolvedSecretString(sanitized, matcher, maxBytes, options.onMatch)
    if (containsResolvedSecret(sanitized, matcher)) {
      throw new ResolvedSecretContentProjectionError(
        'Secret replacement could not produce safe model content'
      )
    }
  }
  if (maxBytes < 0 || Buffer.byteLength(sanitized, 'utf8') > maxBytes) {
    throw new ResolvedSecretContentProjectionError(
      'Sanitized secret-bearing string exceeds the size limit'
    )
  }
  return sanitized
}

function projectContent(
  value: unknown,
  matcher: ResolvedSecretMatcher | undefined,
  maxBytes: number,
  options: ResolvedSecretContentProjectionOptions
): ResolvedSecretContentProjection {
  try {
    return {
      safe: true,
      value: sanitizeContent(
        value,
        matcher,
        {
          nodes: 0,
          ancestors: new WeakSet<object>(),
          outputBytes: 0,
          maxBytes,
        },
        options
      ),
    }
  } catch {
    return { safe: false }
  }
}

export function projectResolvedSecretContent(
  value: unknown,
  matcher: ResolvedSecretMatcher,
  maxBytes = MAX_INLINE_MATERIALIZATION_BYTES,
  options: ResolvedSecretContentProjectionOptions = {}
): ResolvedSecretContentProjection {
  return projectContent(value, matcher, maxBytes, options)
}

/** Returns the registry-revision-cached matcher used for all model-visible projection. */
export function getResolvedSecretModelMatcher(
  registry: ResolvedSecretTraceRegistry | undefined
): ResolvedSecretModelMatcherSnapshot {
  if (!registry) return { complete: false }

  let revision: number | undefined
  try {
    revision = registry.getModelEgressRevision()
    let cached = modelEgressMatcherCache.get(registry)
    if (!cached || cached.revision !== revision) {
      const snapshot = registry.getModelEgressSnapshot()
      cached = {
        revision,
        complete: snapshot.complete,
        ...(snapshot.complete
          ? { matcher: createResolvedSecretModelMatcher(snapshot.matches) }
          : {}),
      }
      modelEgressMatcherCache.set(registry, cached)
    }
    return cached.complete ? { complete: true, matcher: cached.matcher } : { complete: false }
  } catch {
    if (revision !== undefined) {
      modelEgressMatcherCache.set(registry, { revision, complete: false })
    }
    return { complete: false }
  }
}

/**
 * Projects content that is about to become model-visible using committed active provenance.
 * Trusted runtime boundaries activate exact secret-bearing values before this point; unrelated
 * configured secrets and sibling calls that have not committed output cannot affect projection.
 * Missing or permanently incomplete registry state fails closed.
 */
export function projectResolvedSecretModelContent(
  value: unknown,
  registry: ResolvedSecretTraceRegistry | undefined,
  maxBytes = MAX_INLINE_MATERIALIZATION_BYTES,
  options: ResolvedSecretContentProjectionOptions = {}
): ResolvedSecretContentProjection {
  const snapshot = getResolvedSecretModelMatcher(registry)
  if (!snapshot.complete) return { safe: false }
  if (!snapshot.matcher && options.sanitizeInternalIdentifiers !== true) {
    return { safe: true, value }
  }

  return projectContent(value, snapshot.matcher, maxBytes, {
    projectPrimitiveLiterals: true,
    ...options,
  })
}

/**
 * Projects content after applying the same normalization as a JSON wire boundary. This converts
 * values such as dates through their native `toJSON` representation, omits unsupported object
 * fields, and rejects values that JSON itself cannot serialize.
 */
export function projectResolvedSecretModelJsonContent(
  value: unknown,
  registry: ResolvedSecretTraceRegistry | undefined,
  maxBytes = MAX_INLINE_MATERIALIZATION_BYTES,
  options: ResolvedSecretContentProjectionOptions = {}
): ResolvedSecretContentProjection {
  const snapshot = getResolvedSecretModelMatcher(registry)
  if (!snapshot.complete) return { safe: false }

  try {
    const encoded = JSON.stringify(value)
    if (encoded === undefined || Buffer.byteLength(encoded, 'utf8') > maxBytes) {
      return { safe: false }
    }
    const normalized: unknown = JSON.parse(encoded)
    if (!snapshot.matcher && options.sanitizeInternalIdentifiers !== true) {
      return { safe: true, value: normalized }
    }
    const projection = projectResolvedSecretModelContent(normalized, registry, maxBytes, options)
    if (!projection.safe) return projection

    const projectedEncoding = JSON.stringify(projection.value)
    return projectedEncoding !== undefined &&
      Buffer.byteLength(projectedEncoding, 'utf8') <= maxBytes
      ? projection
      : { safe: false }
  } catch {
    return { safe: false }
  }
}

/**
 * Projects logger-visible diagnostics and additionally removes internal-looking runtime names.
 * Non-JSON model boundaries use `projectResolvedSecretModelContent`; JSON tool-result boundaries
 * use `projectResolvedSecretModelJsonContent` to apply their wire semantics before projection.
 */
export function projectResolvedSecretDiagnosticContent(
  value: unknown,
  registry: ResolvedSecretTraceRegistry | undefined,
  maxBytes = MAX_INLINE_MATERIALIZATION_BYTES
): ResolvedSecretContentProjection {
  return projectResolvedSecretModelContent(value, registry, maxBytes, {
    sanitizeInternalIdentifiers: true,
  })
}

/**
 * Produces logger-safe metadata for an execution error without changing the error itself.
 * Complete provenance preserves useful diagnostics after projection; unavailable or incomplete
 * provenance fails closed to structural fields that cannot contain user-controlled text.
 */
export function projectResolvedSecretDiagnosticError(
  error: unknown,
  registry: ResolvedSecretTraceRegistry | undefined,
  details: Record<string, unknown> = {}
): Record<string, unknown> {
  let hasStack = false
  try {
    hasStack = error instanceof Error && typeof error.stack === 'string'
    const diagnostic =
      error instanceof Error
        ? {
            ...details,
            error: error.message,
            errorName: error.name,
            ...(hasStack ? { stack: error.stack } : {}),
          }
        : {
            ...details,
            error: String(error),
          }
    const projection = projectResolvedSecretDiagnosticContent(diagnostic, registry)
    if (projection.safe && isPlainRecord(projection.value)) return projection.value
  } catch {}

  return {
    errorType: error instanceof Error ? 'error' : error === null ? 'null' : typeof error,
    hasStack,
  }
}

/**
 * Returns true only when model projection can prove that content needs no secret or registered
 * internal-alias substitution. Use this for protocol handles that must retain their exact bytes.
 */
export function isResolvedSecretModelContentUnchanged(
  value: unknown,
  registry: ResolvedSecretTraceRegistry | undefined
): boolean {
  const snapshot = getResolvedSecretModelMatcher(registry)
  if (!snapshot.complete) return false
  if (!snapshot.matcher) return true

  const projection = projectContent(value, snapshot.matcher, MAX_INLINE_MATERIALIZATION_BYTES, {
    projectPrimitiveLiterals: true,
    rejectResolvedSecretLiterals: true,
  })
  return projection.safe && isDeepStrictEqual(projection.value, value)
}

/**
 * Projects JSON-encoded model fields structurally, preserving valid JSON while redacting exact
 * typed primitive secrets such as `123` and `true`. Invalid legacy JSON remains a plain string.
 */
export function projectResolvedSecretModelJsonStrings(
  values: readonly (string | undefined)[],
  registry: ResolvedSecretTraceRegistry | undefined,
  maxBytes = MAX_INLINE_MATERIALIZATION_BYTES
): ResolvedSecretContentProjection {
  const snapshot = getResolvedSecretModelMatcher(registry)
  if (!snapshot.complete) return { safe: false }
  if (!snapshot.matcher) {
    let outputBytes = 0
    for (const value of values) {
      if (value === undefined) continue
      outputBytes += Buffer.byteLength(value, 'utf8')
      if (outputBytes > maxBytes) return { safe: false }
    }
    return { safe: true, value: [...values] }
  }

  const projected: Array<string | undefined> = []
  let outputBytes = 0
  const options: ResolvedSecretContentProjectionOptions = {
    projectPrimitiveLiterals: true,
  }

  for (const value of values) {
    if (value === undefined) {
      projected.push(undefined)
      continue
    }

    let parsed: unknown
    let parsedJson = true
    try {
      parsed = JSON.parse(value)
    } catch {
      parsed = value
      parsedJson = false
    }

    const remainingBytes = maxBytes - outputBytes
    const projection = projectContent(parsed, snapshot.matcher, remainingBytes, options)
    if (!projection.safe) return { safe: false }

    let serialized: string
    if (parsedJson) {
      try {
        serialized = JSON.stringify(projection.value)
      } catch {
        return { safe: false }
      }
    } else if (typeof projection.value === 'string') {
      serialized = projection.value
    } else {
      return { safe: false }
    }

    outputBytes += Buffer.byteLength(serialized, 'utf8')
    if (outputBytes > maxBytes) return { safe: false }
    projected.push(serialized)
  }

  return { safe: true, value: projected }
}
