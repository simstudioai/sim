import { isDeepStrictEqual } from 'node:util'
import { isPlainRecord } from '@sim/utils/object'
import { LARGE_ARRAY_MANIFEST_MARKER } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { LARGE_VALUE_REF_MARKER } from '@/lib/execution/payloads/large-value-ref'
import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/materialization.server'
import {
  containsResolvedSecret,
  createResolvedSecretMatcher,
  OPAQUE_RESOLVED_SECRET_REPLACEMENT,
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
const INTERNAL_MODEL_IDENTIFIER_PATTERN =
  /__var_[A-Za-z0-9_]+|__sim_code_\d+_(?:binding|input|runtime)_\d+[A-Za-z0-9_]*|__sim_placeholder_[a-f0-9]{64}__|__sim_runtime_[A-Za-z0-9_]+_\d+[A-Za-z0-9_]*|__SIM_RUNTIME_PAYLOAD_PATH/g

const modelEgressMatcherCache = new WeakMap<
  ResolvedSecretTraceRegistry,
  { revision: number; complete: boolean; matcher?: ResolvedSecretMatcher }
>()

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
  /** Whether internal legacy and compiler runtime identifiers must be removed from model content. */
  sanitizeInternalIdentifiers?: boolean
  /** Receives each exact string secret detected while traversing content. */
  onMatch?: (plaintext: string) => void
}

export type ResolvedSecretContentProjection = { safe: true; value: unknown } | { safe: false }

class ResolvedSecretContentProjectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResolvedSecretContentProjectionError'
  }
}

function internalModelIdentifierReplacement(identifier: string): string {
  return identifier.startsWith('__var_') ? '[REDACTED_SECRET]' : '[RUNTIME_BINDING]'
}

function sanitizeInternalModelIdentifiers(value: string): string {
  return value.replace(INTERNAL_MODEL_IDENTIFIER_PATTERN, internalModelIdentifierReplacement)
}

function sanitizeCollisionProneInternalModelIdentifiers(
  value: string,
  matcher: ResolvedSecretMatcher
): string {
  return value.replace(INTERNAL_MODEL_IDENTIFIER_PATTERN, (identifier) =>
    containsResolvedSecret(identifier, matcher) && !matcher.exactReplacements.has(identifier)
      ? internalModelIdentifierReplacement(identifier)
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
  for (const key of Reflect.ownKeys(value)) {
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
  let sanitized =
    options.sanitizeInternalIdentifiers && matcher
      ? sanitizeCollisionProneInternalModelIdentifiers(value, matcher)
      : value
  sanitized = matcher
    ? sanitizeResolvedSecretString(sanitized, matcher, maxBytes, options.onMatch)
    : sanitized
  sanitized = sanitized.replaceAll(
    `{{${OPAQUE_RESOLVED_SECRET_REPLACEMENT}}}`,
    OPAQUE_RESOLVED_SECRET_REPLACEMENT
  )
  if (options.sanitizeInternalIdentifiers) {
    sanitized = sanitizeInternalModelIdentifiers(sanitized)
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

  try {
    const revision = registry.getModelEgressRevision()
    let cached = modelEgressMatcherCache.get(registry)
    if (!cached || cached.revision !== revision) {
      const snapshot = registry.getModelEgressSnapshot()
      cached = {
        revision,
        complete: snapshot.complete,
        ...(snapshot.complete ? { matcher: createResolvedSecretMatcher(snapshot.matches) } : {}),
      }
      modelEgressMatcherCache.set(registry, cached)
    }
    return cached.complete ? { complete: true, matcher: cached.matcher } : { complete: false }
  } catch {
    return { complete: false }
  }
}

/** Produces a nonempty model control message only when the registry can prove it secret-free. */
export function projectResolvedSecretModelControlMessage(
  message: string,
  registry: ResolvedSecretTraceRegistry | undefined
): string | undefined {
  const projection = projectResolvedSecretModelContent(message, registry)
  if (projection.safe && typeof projection.value === 'string' && projection.value.length > 0) {
    return projection.value
  }

  const snapshot = getResolvedSecretModelMatcher(registry)
  if (!snapshot.complete) return undefined
  for (let codePoint = 0x21; codePoint <= 0x10ffff; codePoint += 1) {
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      codePoint = 0xdfff
      continue
    }
    const candidate = String.fromCodePoint(codePoint)
    if (!snapshot.matcher || !containsResolvedSecret(candidate, snapshot.matcher)) return candidate
  }
  return undefined
}

/**
 * Projects content that is about to become model-visible using every secret the execution could
 * access, not only values activated through placeholder resolution. Missing, pending, or
 * incomplete registry state fails closed.
 */
export function projectResolvedSecretModelContent(
  value: unknown,
  registry: ResolvedSecretTraceRegistry | undefined,
  maxBytes = MAX_INLINE_MATERIALIZATION_BYTES,
  options: ResolvedSecretContentProjectionOptions = {}
): ResolvedSecretContentProjection {
  const snapshot = getResolvedSecretModelMatcher(registry)
  if (!snapshot.complete) return { safe: false }

  return projectContent(value, snapshot.matcher, maxBytes, {
    projectPrimitiveLiterals: true,
    sanitizeInternalIdentifiers: true,
    ...options,
  })
}

/**
 * Returns true only when model projection can prove that content needs no secret or internal-alias
 * substitution. Use this for protocol handles that must retain their exact bytes.
 */
export function isResolvedSecretModelContentUnchanged(
  value: unknown,
  registry: ResolvedSecretTraceRegistry | undefined
): boolean {
  const projection = projectResolvedSecretModelContent(value, registry)
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

  const projected: Array<string | undefined> = []
  let outputBytes = 0
  const options: ResolvedSecretContentProjectionOptions = {
    projectPrimitiveLiterals: true,
    sanitizeInternalIdentifiers: true,
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
