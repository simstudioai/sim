import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isPlainRecord, omit } from '@sim/utils/object'
import {
  isLargeArrayManifest,
  LARGE_ARRAY_MANIFEST_MARKER,
  LARGE_ARRAY_MANIFEST_PREVIEW_MAX_BYTES,
  type LargeArrayManifest,
} from '@/lib/execution/payloads/large-array-manifest-metadata'
import {
  isLargeValueRef,
  LARGE_VALUE_REF_MARKER,
  type LargeValueRef,
} from '@/lib/execution/payloads/large-value-ref'
import {
  MAX_DURABLE_LARGE_VALUE_BYTES,
  MAX_INLINE_MATERIALIZATION_BYTES,
} from '@/lib/execution/payloads/limits'
import type { LargeValueStoreContext } from '@/lib/execution/payloads/store'
import { materializeLargeValueRef, storeLargeValue } from '@/lib/execution/payloads/store'
import type { ToolCall, TraceSpan } from '@/lib/logs/types'
import type { IterationToolCall, ProviderTimingSegment } from '@/executor/types'
import {
  containsResolvedSecret,
  createResolvedSecretMatcher,
  projectResolvedSecretContent,
  type ResolvedSecretMatcher,
} from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('TraceSecretProjection')
const REF_CONCURRENCY = 4
const MAX_CONTENT_NODES = 100_000
const MAX_CONTENT_DEPTH = 100
const MAX_LARGE_VALUES = 1_024
const MAX_LARGE_VALUE_CHAIN_DEPTH = 32
const MAX_LARGE_MANIFEST_CHUNKS = MAX_LARGE_VALUES
const MAX_LARGE_MANIFEST_ITEMS = MAX_CONTENT_NODES
const OMIT = Symbol('omit-trace-content')
const LARGE_VALUE_REF_KEYS = new Set([
  LARGE_VALUE_REF_MARKER,
  'version',
  'id',
  'kind',
  'size',
  'key',
  'executionId',
  'preview',
])
const LARGE_VALUE_REF_REQUIRED_KEYS = new Set([
  LARGE_VALUE_REF_MARKER,
  'version',
  'id',
  'kind',
  'size',
])
const LARGE_ARRAY_MANIFEST_KEYS = new Set([
  LARGE_ARRAY_MANIFEST_MARKER,
  'version',
  'kind',
  'totalCount',
  'chunkCount',
  'byteSize',
  'chunks',
  'preview',
])
const LARGE_ARRAY_MANIFEST_CHUNK_KEYS = new Set(['ref', 'count', 'byteSize'])

interface ProjectionContext {
  matcher: ResolvedSecretMatcher
  store: LargeValueStoreContext
  allowLargeValueWrites: boolean
  safeLargeValues: WeakSet<object>
  oversizedGate: OversizedHydrationGate
  refIoSemaphore: AsyncSemaphore
  sourceLargeValueSizes: Map<string, number>
  largeValueCache: Map<string, Promise<unknown>>
  manifestIds: WeakMap<object, string>
  nextManifestId: number
  largeValueCount: number
  sourceLargeValueBytes: number
  storedLargeValueBytes: number
  storedLargeValueCount: number
}

interface OversizedHydrationGate {
  chain: Promise<void>
}

interface AsyncSemaphore {
  active: number
  waiters: Array<() => void>
}

interface TraversalState {
  nodes: number
  ancestors: WeakSet<object>
}

interface PlaintextInvariantContext {
  matcher: ResolvedSecretMatcher
  safeLargeValues: WeakSet<object>
  /** Valid refs are trusted only after the full projector has already rewritten them. */
  allowVerifiedLargeValues?: boolean
  /** Full post-transform verification hydrates refs instead of trusting their previews. */
  inspectLargeValuePreviews?: boolean
}

interface PostTransformInvariantContext {
  projection: ProjectionContext
  plaintext: PlaintextInvariantContext
  contentState: TraversalState
  collectionState: TraversalState
  collectionSeen: WeakSet<object>
  verificationCache: Map<string, Promise<unknown>>
}

export interface ProjectTraceSpansForSecretsOptions {
  registry?: ResolvedSecretTraceRegistry
  store: LargeValueStoreContext
  /** Read-only display projections omit ref-backed content instead of writing another ref. */
  allowLargeValueWrites?: boolean
}

class TraceSecretProjectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TraceSecretProjectionError'
  }
}

/**
 * Diagnostic payload for a projection fallback.
 *
 * Every {@link TraceSecretProjectionError} message is a fixed literal describing
 * which invariant fired, so it is safe to log. Any other failure originates
 * outside this module and may embed trace content (a JSON parse error quotes the
 * text it choked on), so only its name is reported.
 */
function describeProjectionFailure(error: unknown): { name: string; reason?: string } {
  return {
    name: toError(error).name,
    ...(error instanceof TraceSecretProjectionError ? { reason: error.message } : {}),
  }
}

function createProjectionContext(
  matcher: ResolvedSecretMatcher,
  store: LargeValueStoreContext,
  allowLargeValueWrites: boolean
): ProjectionContext {
  return {
    matcher,
    store,
    allowLargeValueWrites,
    safeLargeValues: new WeakSet<object>(),
    oversizedGate: { chain: Promise.resolve() },
    refIoSemaphore: { active: 0, waiters: [] },
    sourceLargeValueSizes: new Map<string, number>(),
    largeValueCache: new Map<string, Promise<unknown>>(),
    manifestIds: new WeakMap<object, string>(),
    nextManifestId: 0,
    largeValueCount: 0,
    sourceLargeValueBytes: 0,
    storedLargeValueBytes: 0,
    storedLargeValueCount: 0,
  }
}

function visitNode(state: TraversalState, depth: number): void {
  state.nodes += 1
  if (state.nodes > MAX_CONTENT_NODES) {
    throw new TraceSecretProjectionError('Trace content node limit exceeded')
  }
  if (depth > MAX_CONTENT_DEPTH) {
    throw new TraceSecretProjectionError('Trace content depth limit exceeded')
  }
}

function assertArrayFitsTraversal(value: readonly unknown[], state: TraversalState): void {
  if (value.length > MAX_CONTENT_NODES - state.nodes) {
    throw new TraceSecretProjectionError('Trace content array exceeds the traversal limit')
  }
}

function readArrayLength(value: readonly unknown[]): number {
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (
    !lengthDescriptor ||
    !('value' in lengthDescriptor) ||
    lengthDescriptor.enumerable ||
    typeof lengthDescriptor.value !== 'number' ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    throw new TraceSecretProjectionError('Trace array length metadata is invalid')
  }
  return lengthDescriptor.value
}

function* arrayDataEntries(value: readonly unknown[]): Generator<[number, unknown]> {
  const length = readArrayLength(value)

  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index)
    if (!descriptor) continue
    if (!('value' in descriptor)) {
      throw new TraceSecretProjectionError('Trace content accessors are not supported')
    }
    yield [index, descriptor.value]
  }
}

function readCanonicalDataArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TraceSecretProjectionError(`${label} must be an array`)
  }

  const length = readArrayLength(value)
  const entries: unknown[] = new Array<unknown>(length)
  let entryCount = 0

  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue
    if (typeof key !== 'string') {
      throw new TraceSecretProjectionError('Trace arrays cannot contain symbol properties')
    }
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== key) {
      throw new TraceSecretProjectionError('Trace arrays cannot contain custom properties')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TraceSecretProjectionError('Trace array entries must be enumerable data properties')
    }
    entries[index] = descriptor.value
    entryCount += 1
  }

  if (entryCount !== length) {
    throw new TraceSecretProjectionError(`${label} cannot contain sparse entries`)
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TraceSecretProjectionError(`${label} must use the canonical array prototype`)
  }
  return entries
}

function enterObject(value: object, state: TraversalState): void {
  if (state.ancestors.has(value)) {
    throw new TraceSecretProjectionError('Cyclic trace content is not supported')
  }
  state.ancestors.add(value)
}

function leaveObject(value: object, state: TraversalState): void {
  state.ancestors.delete(value)
}

function* enumerableDataEntries(value: object): Generator<[string, unknown]> {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      throw new TraceSecretProjectionError('Trace objects cannot contain symbol properties')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TraceSecretProjectionError('Trace content accessors are not supported')
    }
    yield [key, descriptor.value]
  }
}

type LargeValueCandidate = LargeValueRef | LargeArrayManifest

function readOwnDataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor) return undefined
  if (!('value' in descriptor)) {
    throw new TraceSecretProjectionError('Trace content accessors are not supported')
  }
  return descriptor.value
}

function assertExactPlainDataRecord(
  value: object,
  allowedKeys: ReadonlySet<string>,
  requiredKeys: ReadonlySet<string>,
  label: string
): void {
  const presentKeys = new Set<string>()
  for (const [key] of enumerableDataEntries(value)) {
    if (!allowedKeys.has(key)) {
      throw new TraceSecretProjectionError(`${label} contains unsupported metadata`)
    }
    presentKeys.add(key)
  }
  for (const key of requiredKeys) {
    if (!presentKeys.has(key)) {
      throw new TraceSecretProjectionError(`${label} is missing required metadata`)
    }
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TraceSecretProjectionError(`${label} must be a plain object`)
  }
}

function readCanonicalLargeValueRef(value: object, marker: unknown): LargeValueRef {
  const canonicalRef = {
    [LARGE_VALUE_REF_MARKER]: marker,
    version: readOwnDataProperty(value, 'version'),
    id: readOwnDataProperty(value, 'id'),
    kind: readOwnDataProperty(value, 'kind'),
    size: readOwnDataProperty(value, 'size'),
    key: readOwnDataProperty(value, 'key'),
    executionId: readOwnDataProperty(value, 'executionId'),
    preview: readOwnDataProperty(value, 'preview'),
  }
  if (!isLargeValueRef(canonicalRef) || canonicalRef.size > MAX_DURABLE_LARGE_VALUE_BYTES) {
    throw new TraceSecretProjectionError('Trace content has invalid large-value metadata')
  }
  return canonicalRef
}

function getLargeValueCandidate(value: unknown): LargeValueCandidate | undefined {
  if (!value || typeof value !== 'object') return undefined

  const largeValueMarker = readOwnDataProperty(value, LARGE_VALUE_REF_MARKER)
  const manifestMarker = readOwnDataProperty(value, LARGE_ARRAY_MANIFEST_MARKER)
  if (largeValueMarker === true && manifestMarker === true) {
    throw new TraceSecretProjectionError('Trace content has ambiguous large-value metadata')
  }
  if (largeValueMarker === true) {
    assertExactPlainDataRecord(
      value,
      LARGE_VALUE_REF_KEYS,
      LARGE_VALUE_REF_REQUIRED_KEYS,
      'Trace large-value ref'
    )
    readCanonicalLargeValueRef(value, largeValueMarker)
    return value as LargeValueRef
  }
  if (manifestMarker !== true) return undefined

  assertExactPlainDataRecord(
    value,
    LARGE_ARRAY_MANIFEST_KEYS,
    LARGE_ARRAY_MANIFEST_KEYS,
    'Trace large-array manifest'
  )

  const chunks = readOwnDataProperty(value, 'chunks')
  const preview = readOwnDataProperty(value, 'preview')
  const chunkValues = readCanonicalDataArray(chunks, 'Trace manifest chunks')
  const previewValues = readCanonicalDataArray(preview, 'Trace manifest preview')
  const canonicalChunks: Array<{ ref: LargeValueRef; count: unknown; byteSize: unknown }> = []
  for (const chunk of chunkValues) {
    if (!chunk || typeof chunk !== 'object') {
      throw new TraceSecretProjectionError('Trace manifest chunk metadata is invalid')
    }
    assertExactPlainDataRecord(
      chunk,
      LARGE_ARRAY_MANIFEST_CHUNK_KEYS,
      LARGE_ARRAY_MANIFEST_CHUNK_KEYS,
      'Trace manifest chunk'
    )
    const chunkRef = getLargeValueCandidate(readOwnDataProperty(chunk, 'ref'))
    if (!chunkRef || readOwnDataProperty(chunkRef, LARGE_VALUE_REF_MARKER) !== true) {
      throw new TraceSecretProjectionError('Trace manifest chunk ref is invalid')
    }
    canonicalChunks.push({
      ref: readCanonicalLargeValueRef(chunkRef, true),
      count: readOwnDataProperty(chunk, 'count'),
      byteSize: readOwnDataProperty(chunk, 'byteSize'),
    })
  }

  const canonicalManifest = {
    [LARGE_ARRAY_MANIFEST_MARKER]: manifestMarker,
    version: readOwnDataProperty(value, 'version'),
    kind: readOwnDataProperty(value, 'kind'),
    totalCount: readOwnDataProperty(value, 'totalCount'),
    chunkCount: readOwnDataProperty(value, 'chunkCount'),
    byteSize: readOwnDataProperty(value, 'byteSize'),
    chunks: canonicalChunks,
    preview: previewValues,
  }
  if (
    !isLargeArrayManifest(canonicalManifest) ||
    canonicalManifest.chunks.length > MAX_LARGE_MANIFEST_CHUNKS ||
    canonicalManifest.totalCount > MAX_LARGE_MANIFEST_ITEMS ||
    canonicalManifest.byteSize > MAX_DURABLE_LARGE_VALUE_BYTES
  ) {
    throw new TraceSecretProjectionError('Trace content has invalid large-array metadata')
  }
  return value as LargeArrayManifest
}

function collectLargeValues(
  value: unknown,
  refs: object[],
  seen: WeakSet<object>,
  state: TraversalState,
  depth = 0
): void {
  visitNode(state, depth)
  const largeValue = getLargeValueCandidate(value)
  if (largeValue) {
    refs.push(largeValue)
    return
  }
  if (value === null || typeof value !== 'object') return
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    throw new TraceSecretProjectionError('Unsupported trace content object')
  }
  if (seen.has(value)) return
  seen.add(value)
  enterObject(value, state)
  try {
    if (Array.isArray(value)) {
      assertArrayFitsTraversal(value, state)
      for (const [, item] of arrayDataEntries(value)) {
        collectLargeValues(item, refs, seen, state, depth + 1)
      }
      return
    }
    for (const [, item] of enumerableDataEntries(value)) {
      collectLargeValues(item, refs, seen, state, depth + 1)
    }
  } finally {
    leaveObject(value, state)
  }
}

function substituteLargeValues(
  value: unknown,
  replacements: Map<object, unknown>,
  state: TraversalState,
  depth = 0
): unknown {
  visitNode(state, depth)
  if (getLargeValueCandidate(value)) {
    if (!replacements.has(value as object)) {
      throw new TraceSecretProjectionError('Large trace value was not safely replaced')
    }
    return replacements.get(value as object)
  }
  if (value === null || typeof value !== 'object') return value
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    throw new TraceSecretProjectionError('Unsupported trace content object')
  }

  enterObject(value, state)
  try {
    if (Array.isArray(value)) {
      assertArrayFitsTraversal(value, state)
      const substituted = new Array<unknown>(value.length)
      for (const [index, item] of arrayDataEntries(value)) {
        substituted[index] = substituteLargeValues(item, replacements, state, depth + 1)
      }
      return substituted
    }
    const substituted = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>
    for (const [key, item] of enumerableDataEntries(value)) {
      Object.defineProperty(substituted, key, {
        value: substituteLargeValues(item, replacements, state, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    return substituted
  } finally {
    leaveObject(value, state)
  }
}

async function runSerially<T>(gate: OversizedHydrationGate, run: () => Promise<T>): Promise<T> {
  const result = gate.chain.then(run)
  gate.chain = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

async function runWithSemaphore<T>(semaphore: AsyncSemaphore, run: () => Promise<T>): Promise<T> {
  if (semaphore.active >= REF_CONCURRENCY) {
    await new Promise<void>((resolve) => semaphore.waiters.push(resolve))
  } else {
    semaphore.active += 1
  }

  try {
    return await run()
  } finally {
    const next = semaphore.waiters.shift()
    if (next) next()
    else semaphore.active -= 1
  }
}

function getLargeValueKey(value: LargeValueCandidate, context: ProjectionContext): string {
  if (isLargeValueRef(value)) {
    return `ref:${value.executionId ?? ''}:${value.key ?? ''}:${value.id}`
  }
  let id = context.manifestIds.get(value)
  if (!id) {
    id = `manifest:${context.nextManifestId}`
    context.nextManifestId += 1
    context.manifestIds.set(value, id)
  }
  return id
}

function registerSourceLargeValue(
  value: LargeValueCandidate,
  key: string,
  context: ProjectionContext
): void {
  const size = isLargeValueRef(value) ? value.size : 0
  const registeredSize = context.sourceLargeValueSizes.get(key)
  if (registeredSize !== undefined) {
    if (registeredSize !== size) {
      throw new TraceSecretProjectionError('Trace large-value metadata is inconsistent')
    }
    return
  }
  if (
    context.largeValueCount + 1 > MAX_LARGE_VALUES ||
    context.sourceLargeValueBytes + size > MAX_DURABLE_LARGE_VALUE_BYTES
  ) {
    throw new TraceSecretProjectionError('Trace large-value projection budget exceeded')
  }
  context.sourceLargeValueSizes.set(key, size)
  context.largeValueCount += 1
  context.sourceLargeValueBytes += size
}

function extendLargeValuePath(path: ReadonlySet<string>, key: string): Set<string> {
  if (path.has(key) || path.size >= MAX_LARGE_VALUE_CHAIN_DEPTH) {
    throw new TraceSecretProjectionError(
      'Cyclic or deeply nested trace large values are unsupported'
    )
  }
  return new Set([...path, key])
}

async function materializeSourceRef(
  ref: LargeValueRef,
  context: ProjectionContext
): Promise<unknown> {
  const materialize = () =>
    runWithSemaphore(context.refIoSemaphore, () =>
      materializeLargeValueRef(ref, {
        ...context.store,
        trackReference: false,
        maxBytes: MAX_DURABLE_LARGE_VALUE_BYTES,
      })
    )
  const materialized =
    ref.size > MAX_INLINE_MATERIALIZATION_BYTES
      ? await runSerially(context.oversizedGate, materialize)
      : await materialize()
  if (materialized === undefined) {
    throw new TraceSecretProjectionError('Large trace value could not be materialized')
  }
  return materialized
}

async function sanitizeMaterializedValue(
  value: unknown,
  context: ProjectionContext,
  maxBytes = MAX_INLINE_MATERIALIZATION_BYTES,
  path: ReadonlySet<string> = new Set<string>(),
  withinRefWorker = false
): Promise<unknown> {
  const withSafeRefs = await replaceLargeValues(value, context, path, withinRefWorker)
  const projection = projectResolvedSecretContent(withSafeRefs, context.matcher, maxBytes, {
    isOpaqueSafeObject: (candidate) => context.safeLargeValues.has(candidate),
    sanitizeInternalIdentifiers: true,
  })
  if (!projection.safe) {
    throw new TraceSecretProjectionError('Trace content could not be sanitized')
  }
  return projection.value
}

async function storeSanitizedLargeValue(
  value: unknown,
  context: ProjectionContext
): Promise<LargeValueRef> {
  const json = JSON.stringify(value)
  if (json === undefined) {
    throw new TraceSecretProjectionError('Sanitized large value is not JSON serializable')
  }
  const size = Buffer.byteLength(json, 'utf8')
  if (size > MAX_DURABLE_LARGE_VALUE_BYTES) {
    throw new TraceSecretProjectionError('Sanitized large value exceeds the durable size limit')
  }
  if (
    context.storedLargeValueCount + 1 > MAX_LARGE_VALUES ||
    context.storedLargeValueBytes + size > MAX_DURABLE_LARGE_VALUE_BYTES
  ) {
    throw new TraceSecretProjectionError('Sanitized trace storage budget exceeded')
  }

  context.storedLargeValueCount += 1
  context.storedLargeValueBytes += size
  try {
    const stored = await runWithSemaphore(context.refIoSemaphore, () =>
      storeLargeValue(value, json, size, {
        ...context.store,
        requireDurable: true,
      })
    )
    if (!isLargeValueRef(stored)) {
      throw new TraceSecretProjectionError('Trace storage returned invalid large-value metadata')
    }
    context.safeLargeValues.add(stored)
    return stored
  } catch (error) {
    context.storedLargeValueCount -= 1
    context.storedLargeValueBytes -= size
    throw error
  }
}

async function replaceLargeValueRef(
  ref: LargeValueRef,
  context: ProjectionContext,
  path: ReadonlySet<string>
): Promise<LargeValueRef> {
  const materialized = await materializeSourceRef(ref, context)
  const sanitized = await sanitizeMaterializedValue(
    materialized,
    context,
    MAX_DURABLE_LARGE_VALUE_BYTES,
    path,
    true
  )
  const stored = await storeSanitizedLargeValue(sanitized, context)
  if (getLargeValueKey(stored, context) === getLargeValueKey(ref, context)) {
    throw new TraceSecretProjectionError('Trace storage reused the source large-value reference')
  }
  return stored
}

async function replaceLargeArrayManifest(
  manifest: LargeArrayManifest,
  context: ProjectionContext,
  path: ReadonlySet<string>
): Promise<LargeArrayManifest> {
  const preview = await sanitizeMaterializedValue(
    manifest.preview,
    context,
    LARGE_ARRAY_MANIFEST_PREVIEW_MAX_BYTES,
    path,
    true
  )
  if (!Array.isArray(preview) || preview.length > 3) {
    throw new TraceSecretProjectionError('Sanitized trace manifest preview is invalid')
  }

  const chunks: LargeArrayManifest['chunks'] = []
  const sourceChunkKeys = new Set(
    manifest.chunks.map((chunk) => getLargeValueKey(chunk.ref, context))
  )
  const storedChunkKeys = new Set<string>()
  let totalCount = 0
  for (const chunk of manifest.chunks) {
    const chunkKey = getLargeValueKey(chunk.ref, context)
    const chunkPath = extendLargeValuePath(path, chunkKey)
    registerSourceLargeValue(chunk.ref, chunkKey, context)
    const materialized = await materializeSourceRef(chunk.ref, context)
    if (!Array.isArray(materialized) || materialized.length !== chunk.count) {
      throw new TraceSecretProjectionError('Large trace manifest chunk is invalid')
    }
    const remainingOutputBytes = MAX_DURABLE_LARGE_VALUE_BYTES - context.storedLargeValueBytes
    if (remainingOutputBytes <= 0) {
      throw new TraceSecretProjectionError('Sanitized trace storage budget exceeded')
    }
    const sanitized = await sanitizeMaterializedValue(
      materialized,
      context,
      remainingOutputBytes,
      chunkPath,
      true
    )
    if (!Array.isArray(sanitized)) {
      throw new TraceSecretProjectionError('Sanitized trace manifest chunk is invalid')
    }
    totalCount += sanitized.length
    const ref = await storeSanitizedLargeValue(sanitized, context)
    const storedChunkKey = getLargeValueKey(ref, context)
    if (sourceChunkKeys.has(storedChunkKey) || storedChunkKeys.has(storedChunkKey)) {
      throw new TraceSecretProjectionError('Trace storage returned a reused manifest chunk ref')
    }
    storedChunkKeys.add(storedChunkKey)
    chunks.push({ ref, count: sanitized.length, byteSize: ref.size })
  }
  if (totalCount !== manifest.totalCount) {
    throw new TraceSecretProjectionError('Sanitized trace manifest item count changed')
  }

  const result: LargeArrayManifest = {
    __simLargeArrayManifest: true,
    version: 2,
    kind: 'array',
    totalCount,
    chunkCount: chunks.length,
    byteSize: chunks.reduce((sum, chunk) => sum + chunk.byteSize, 0),
    chunks,
    preview,
  }
  context.safeLargeValues.add(result)
  return result
}

async function replaceLargeValue(
  value: LargeValueCandidate,
  context: ProjectionContext,
  path: ReadonlySet<string>
): Promise<unknown> {
  if (!context.allowLargeValueWrites) {
    throw new TraceSecretProjectionError('Large trace values are disabled for read-only projection')
  }
  const key = getLargeValueKey(value, context)
  const nextPath = extendLargeValuePath(path, key)
  registerSourceLargeValue(value, key, context)
  const cached = context.largeValueCache.get(key)
  if (cached) return cached

  const replacement = isLargeValueRef(value)
    ? replaceLargeValueRef(value, context, nextPath)
    : replaceLargeArrayManifest(value, context, nextPath)
  context.largeValueCache.set(key, replacement)
  return replacement
}

async function resolveLargeValueReplacements(
  refs: object[],
  context: ProjectionContext,
  path: ReadonlySet<string>,
  withinRefWorker: boolean
): Promise<Map<object, unknown>> {
  const uniqueRefs = [...new Set(refs)]
  const replacements = new Map<object, unknown>()
  let firstError: unknown
  let cursor = 0

  const worker = async (): Promise<void> => {
    while (firstError === undefined) {
      const index = cursor
      cursor += 1
      if (index >= uniqueRefs.length) return
      const ref = uniqueRefs[index]
      try {
        const candidate = getLargeValueCandidate(ref)
        if (!candidate) {
          throw new TraceSecretProjectionError(
            'Trace large-value metadata changed during projection'
          )
        }
        replacements.set(ref, await replaceLargeValue(candidate, context, path))
      } catch (error) {
        if (firstError === undefined) firstError = error
        return
      }
    }
  }

  const workerCount = withinRefWorker ? 1 : Math.min(REF_CONCURRENCY, uniqueRefs.length)
  await Promise.all(Array.from({ length: workerCount }, worker))

  if (firstError !== undefined) throw firstError
  return replacements
}

async function replaceLargeValues(
  value: unknown,
  context: ProjectionContext,
  path: ReadonlySet<string>,
  withinRefWorker: boolean
): Promise<unknown> {
  const refs: object[] = []
  collectLargeValues(value, refs, new WeakSet<object>(), {
    nodes: 0,
    ancestors: new WeakSet<object>(),
  })
  if (refs.length === 0) return value
  const replacements = await resolveLargeValueReplacements(refs, context, path, withinRefWorker)
  return substituteLargeValues(value, replacements, {
    nodes: 0,
    ancestors: new WeakSet<object>(),
  })
}

async function sanitizeContentField(
  value: unknown,
  context: ProjectionContext
): Promise<unknown | typeof OMIT> {
  try {
    return await sanitizeMaterializedValue(value, context)
  } catch (error) {
    logger.warn('Omitting trace content that could not be sanitized', {
      failure: describeProjectionFailure(error),
    })
    return OMIT
  }
}

function assertTraceStructureArrayFits(
  values: readonly unknown[],
  state: BoundedTraceStructureState
): void {
  if (values.length > MAX_CONTENT_NODES - state.nodes) {
    state.truncated = true
    throw new TraceSecretProjectionError('Trace structure array exceeds the projection limit')
  }
}

async function sanitizeIterationToolCalls(
  calls: IterationToolCall[],
  context: ProjectionContext,
  state: BoundedTraceStructureState,
  depth: number
): Promise<IterationToolCall[]> {
  assertTraceStructureArrayFits(calls, state)
  const sanitized: IterationToolCall[] = []
  for (const call of calls) {
    if (!takeTraceStructureNode(state, depth)) {
      throw new TraceSecretProjectionError('Trace tool-call structure limit exceeded')
    }
    const args = await sanitizeContentField(call.arguments, context)
    sanitized.push(
      args === OMIT
        ? (omit(call, ['arguments']) as IterationToolCall)
        : { ...call, arguments: args as IterationToolCall['arguments'] }
    )
  }
  return sanitized
}

async function sanitizeLegacyToolCalls(
  calls: ToolCall[],
  context: ProjectionContext,
  state: BoundedTraceStructureState,
  depth: number
): Promise<ToolCall[]> {
  assertTraceStructureArrayFits(calls, state)
  const sanitized: ToolCall[] = []
  for (const call of calls) {
    if (!takeTraceStructureNode(state, depth)) {
      throw new TraceSecretProjectionError('Trace tool-call structure limit exceeded')
    }
    let projected: ToolCall = { ...call }
    if (call.input !== undefined) {
      const input = await sanitizeContentField(call.input, context)
      if (input === OMIT) projected = omit(projected, ['input']) as ToolCall
      else projected.input = input as Record<string, unknown>
    }
    if (call.output !== undefined) {
      const output = await sanitizeContentField(call.output, context)
      if (output === OMIT) projected = omit(projected, ['output']) as ToolCall
      else projected.output = output as Record<string, unknown>
    }
    if (call.error !== undefined) {
      const error = await sanitizeContentField(call.error, context)
      if (error === OMIT) projected = omit(projected, ['error']) as ToolCall
      else projected.error = error as string
    }
    sanitized.push(projected)
  }
  return sanitized
}

async function sanitizeProviderSegment(
  segment: ProviderTimingSegment,
  context: ProjectionContext,
  state: BoundedTraceStructureState,
  depth: number
): Promise<ProviderTimingSegment> {
  if (!takeTraceStructureNode(state, depth)) {
    throw new TraceSecretProjectionError('Trace provider structure limit exceeded')
  }
  let projected: ProviderTimingSegment = { ...segment }

  for (const key of ['assistantContent', 'thinkingContent', 'errorMessage'] as const) {
    const value = segment[key]
    if (value === undefined) continue
    const sanitized = await sanitizeContentField(value, context)
    if (sanitized === OMIT) {
      projected = omit(projected, [key]) as ProviderTimingSegment
    } else {
      projected[key] = sanitized as string
    }
  }

  if (segment.toolCalls !== undefined) {
    projected.toolCalls = await sanitizeIterationToolCalls(
      segment.toolCalls,
      context,
      state,
      depth + 1
    )
  }

  return projected
}

async function sanitizeTraceSpan(
  span: TraceSpan,
  context: ProjectionContext,
  depth: number,
  state: BoundedTraceStructureState
): Promise<TraceSpan> {
  if (!takeTraceStructureNode(state, depth)) {
    throw new TraceSecretProjectionError('Trace span structure limit exceeded')
  }

  let projected = omit(span, ['displayResolvedSecretTraceProvenance']) as TraceSpan

  for (const key of ['input', 'output', 'thinking', 'errorMessage'] as const) {
    const value = span[key]
    if (value === undefined) continue
    const sanitized = await sanitizeContentField(value, context)
    if (sanitized === OMIT) {
      projected = omit(projected, [key]) as TraceSpan
    } else {
      projected[key] = sanitized as never
    }
  }

  if (span.modelToolCalls !== undefined) {
    projected.modelToolCalls = await sanitizeIterationToolCalls(
      span.modelToolCalls,
      context,
      state,
      depth + 1
    )
  }

  if (span.toolCalls !== undefined) {
    projected.toolCalls = await sanitizeLegacyToolCalls(span.toolCalls, context, state, depth + 1)
  }

  if (span.providerTiming !== undefined) {
    assertTraceStructureArrayFits(span.providerTiming.segments, state)
    const segments: ProviderTimingSegment[] = []
    for (const segment of span.providerTiming.segments) {
      segments.push(await sanitizeProviderSegment(segment, context, state, depth + 1))
    }
    projected.providerTiming = { ...span.providerTiming, segments }
  }

  if (span.children !== undefined) {
    assertTraceStructureArrayFits(span.children, state)
    const children: TraceSpan[] = []
    for (const child of span.children) {
      children.push(await sanitizeTraceSpan(child, context, depth + 1, state))
    }
    projected.children = children
  }

  return projected
}

function stripLegacyToolCallContent(call: ToolCall): ToolCall {
  return omit(call, ['input', 'output', 'error']) as ToolCall
}

function stripIterationToolCallContent(call: IterationToolCall): IterationToolCall {
  return omit(call, ['arguments']) as IterationToolCall
}

interface BoundedTraceStructureState {
  nodes: number
  truncated: boolean
}

function takeTraceStructureNode(state: BoundedTraceStructureState, depth: number): boolean {
  if (state.nodes >= MAX_CONTENT_NODES || depth > MAX_CONTENT_DEPTH) {
    state.truncated = true
    return false
  }
  state.nodes += 1
  return true
}

function projectBoundedArray<T, U>(
  values: readonly T[],
  project: (value: T) => U | undefined
): U[] {
  const projected: U[] = []
  for (const value of values) {
    const item = project(value)
    if (item === undefined) break
    projected.push(item)
  }
  return projected
}

function structuralOnlyIterationToolCall(
  call: IterationToolCall,
  state: BoundedTraceStructureState,
  depth: number
): IterationToolCall | undefined {
  if (!takeTraceStructureNode(state, depth)) return undefined
  return stripIterationToolCallContent(call)
}

function structuralOnlyLegacyToolCall(
  call: ToolCall,
  state: BoundedTraceStructureState,
  depth: number
): ToolCall | undefined {
  if (!takeTraceStructureNode(state, depth)) return undefined
  return stripLegacyToolCallContent(call)
}

function structuralOnlyProviderSegment(
  segment: ProviderTimingSegment,
  state: BoundedTraceStructureState,
  depth: number
): ProviderTimingSegment | undefined {
  if (!takeTraceStructureNode(state, depth)) return undefined
  const {
    assistantContent: _assistantContent,
    thinkingContent: _thinkingContent,
    toolCalls,
    errorMessage: _errorMessage,
    ...structural
  } = segment
  return {
    ...structural,
    ...(toolCalls
      ? {
          toolCalls: projectBoundedArray(toolCalls, (call) =>
            structuralOnlyIterationToolCall(call, state, depth + 1)
          ),
        }
      : {}),
  }
}

function structuralOnlySpan(
  span: TraceSpan,
  state: BoundedTraceStructureState,
  depth = 0
): TraceSpan | undefined {
  if (!takeTraceStructureNode(state, depth)) return undefined
  const {
    input: _input,
    output: _output,
    thinking: _thinking,
    modelToolCalls,
    toolCalls,
    errorMessage: _errorMessage,
    children,
    providerTiming,
    displayResolvedSecretTraceProvenance: _displayResolvedSecretTraceProvenance,
    ...structural
  } = span

  return {
    ...structural,
    ...(modelToolCalls
      ? {
          modelToolCalls: projectBoundedArray(modelToolCalls, (call) =>
            structuralOnlyIterationToolCall(call, state, depth + 1)
          ),
        }
      : {}),
    ...(toolCalls
      ? {
          toolCalls: projectBoundedArray(toolCalls, (call) =>
            structuralOnlyLegacyToolCall(call, state, depth + 1)
          ),
        }
      : {}),
    ...(providerTiming
      ? {
          providerTiming: {
            ...providerTiming,
            segments: projectBoundedArray(providerTiming.segments, (segment) =>
              structuralOnlyProviderSegment(segment, state, depth + 1)
            ),
          },
        }
      : {}),
    ...(children
      ? {
          children: projectBoundedArray(children, (child) =>
            structuralOnlySpan(child, state, depth + 1)
          ),
        }
      : {}),
  }
}

function cloneIterationToolCall(
  call: IterationToolCall,
  state: BoundedTraceStructureState,
  depth: number
): IterationToolCall | undefined {
  if (!takeTraceStructureNode(state, depth)) return undefined
  return { ...call }
}

function cloneLegacyToolCall(
  call: ToolCall,
  state: BoundedTraceStructureState,
  depth: number
): ToolCall | undefined {
  if (!takeTraceStructureNode(state, depth)) return undefined
  return { ...call }
}

function cloneProviderSegment(
  segment: ProviderTimingSegment,
  state: BoundedTraceStructureState,
  depth: number
): ProviderTimingSegment | undefined {
  if (!takeTraceStructureNode(state, depth)) return undefined
  return {
    ...segment,
    ...(segment.toolCalls
      ? {
          toolCalls: projectBoundedArray(segment.toolCalls, (call) =>
            cloneIterationToolCall(call, state, depth + 1)
          ),
        }
      : {}),
  }
}

function cloneTraceSpanForProjection(
  span: TraceSpan,
  state: BoundedTraceStructureState,
  depth = 0
): TraceSpan | undefined {
  if (!takeTraceStructureNode(state, depth)) return undefined
  const {
    displayResolvedSecretTraceProvenance: _displayResolvedSecretTraceProvenance,
    ...publicSpan
  } = span
  return {
    ...publicSpan,
    ...(span.modelToolCalls
      ? {
          modelToolCalls: projectBoundedArray(span.modelToolCalls, (call) =>
            cloneIterationToolCall(call, state, depth + 1)
          ),
        }
      : {}),
    ...(span.toolCalls
      ? {
          toolCalls: projectBoundedArray(span.toolCalls, (call) =>
            cloneLegacyToolCall(call, state, depth + 1)
          ),
        }
      : {}),
    ...(span.providerTiming
      ? {
          providerTiming: {
            ...span.providerTiming,
            segments: projectBoundedArray(span.providerTiming.segments, (segment) =>
              cloneProviderSegment(segment, state, depth + 1)
            ),
          },
        }
      : {}),
    ...(span.children
      ? {
          children: projectBoundedArray(span.children, (child) =>
            cloneTraceSpanForProjection(child, state, depth + 1)
          ),
        }
      : {}),
  }
}

function projectBoundedTraceSpans(
  traceSpans: TraceSpan[],
  project: (
    span: TraceSpan,
    state: BoundedTraceStructureState,
    depth: number
  ) => TraceSpan | undefined
): TraceSpan[] {
  const state: BoundedTraceStructureState = { nodes: 0, truncated: false }
  const projected = projectBoundedArray(traceSpans, (span) => project(span, state, 0))
  if (state.truncated) {
    logger.warn('Trace structure exceeded projection limits; truncating projected structure')
  }
  return projected
}

function structuralOnlyTraceSpans(traceSpans: TraceSpan[]): TraceSpan[] {
  try {
    return projectBoundedTraceSpans(traceSpans, structuralOnlySpan)
  } catch (error) {
    logger.warn('Trace structure could not be safely traversed; omitting projected spans', {
      failure: describeProjectionFailure(error),
    })
    return []
  }
}

function cloneTraceSpansForProjection(traceSpans: TraceSpan[]): TraceSpan[] {
  return projectBoundedTraceSpans(traceSpans, cloneTraceSpanForProjection)
}

function assertNoPlaintext(
  value: unknown,
  context: PlaintextInvariantContext,
  state: TraversalState,
  depth = 0
): void {
  visitNode(state, depth)
  if (typeof value === 'string') {
    if (containsResolvedSecret(value, context.matcher)) {
      throw new TraceSecretProjectionError('Sanitized trace content still contains a secret')
    }
    return
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    if (containsResolvedSecret(String(value), context.matcher)) {
      throw new TraceSecretProjectionError('Sanitized trace primitive still contains a secret')
    }
    return
  }
  const largeValue = getLargeValueCandidate(value)
  if (largeValue) {
    if (!context.safeLargeValues.has(value as object) && !context.allowVerifiedLargeValues) {
      throw new TraceSecretProjectionError('Sanitized trace content contains an unverified ref')
    }
    if (context.inspectLargeValuePreviews !== false) {
      if (isLargeValueRef(largeValue)) {
        const preview = readOwnDataProperty(largeValue, 'preview')
        if (preview !== undefined) {
          assertNoPlaintext(preview, context, state, depth + 1)
        }
      } else {
        assertNoPlaintext(largeValue.preview, context, state, depth + 1)
        for (const chunk of largeValue.chunks) {
          assertNoPlaintext(chunk.ref, context, state, depth + 1)
        }
      }
    }
    return
  }
  if (value === null || typeof value !== 'object') return
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    throw new TraceSecretProjectionError('Sanitized trace content contains an unsupported object')
  }

  enterObject(value, state)
  try {
    if (Array.isArray(value)) {
      assertArrayFitsTraversal(value, state)
      for (const [, item] of arrayDataEntries(value)) {
        assertNoPlaintext(item, context, state, depth + 1)
      }
      return
    }
    for (const [key, item] of enumerableDataEntries(value)) {
      if (containsResolvedSecret(key, context.matcher)) {
        throw new TraceSecretProjectionError('Sanitized trace key still contains a secret')
      }
      assertNoPlaintext(item, context, state, depth + 1)
    }
  } finally {
    leaveObject(value, state)
  }
}

type TraceContentVisitor = (value: unknown) => void

function visitTraceSpanContent(
  span: TraceSpan,
  visit: TraceContentVisitor,
  structureState: BoundedTraceStructureState,
  depth = 0
): void {
  if (!takeTraceStructureNode(structureState, depth)) {
    throw new TraceSecretProjectionError('Trace invariant structure limit exceeded')
  }

  const visitField = (value: unknown): void => {
    if (value !== undefined) visit(value)
  }

  visitField(span.input)
  visitField(span.output)
  visitField(span.thinking)
  visitField(span.errorMessage)
  if (span.modelToolCalls) {
    assertTraceStructureArrayFits(span.modelToolCalls, structureState)
    for (const call of span.modelToolCalls) {
      if (!takeTraceStructureNode(structureState, depth + 1)) {
        throw new TraceSecretProjectionError('Trace invariant tool-call limit exceeded')
      }
      if (Object.hasOwn(call, 'arguments')) visitField(call.arguments)
    }
  }
  if (span.toolCalls) {
    assertTraceStructureArrayFits(span.toolCalls, structureState)
    for (const call of span.toolCalls) {
      if (!takeTraceStructureNode(structureState, depth + 1)) {
        throw new TraceSecretProjectionError('Trace invariant legacy tool-call limit exceeded')
      }
      visitField(call.input)
      visitField(call.output)
      visitField(call.error)
    }
  }
  if (span.providerTiming) {
    assertTraceStructureArrayFits(span.providerTiming.segments, structureState)
    for (const segment of span.providerTiming.segments) {
      if (!takeTraceStructureNode(structureState, depth + 1)) {
        throw new TraceSecretProjectionError('Trace invariant provider-segment limit exceeded')
      }
      visitField(segment.assistantContent)
      visitField(segment.thinkingContent)
      visitField(segment.errorMessage)
      assertTraceStructureArrayFits(segment.toolCalls ?? [], structureState)
      for (const call of segment.toolCalls ?? []) {
        if (!takeTraceStructureNode(structureState, depth + 2)) {
          throw new TraceSecretProjectionError('Trace invariant provider tool-call limit exceeded')
        }
        if (Object.hasOwn(call, 'arguments')) visitField(call.arguments)
      }
    }
  }
  assertTraceStructureArrayFits(span.children ?? [], structureState)
  for (const child of span.children ?? []) {
    visitTraceSpanContent(child, visit, structureState, depth + 1)
  }
}

function visitTraceSpansContent(traceSpans: TraceSpan[], visit: TraceContentVisitor): void {
  const structureState: BoundedTraceStructureState = { nodes: 0, truncated: false }
  assertTraceStructureArrayFits(traceSpans, structureState)
  for (const span of traceSpans) {
    visitTraceSpanContent(span, visit, structureState)
  }
}

function assertTraceSpansContentIsSafe(
  traceSpans: TraceSpan[],
  context: PlaintextInvariantContext
): void {
  const contentState: TraversalState = { nodes: 0, ancestors: new WeakSet<object>() }
  visitTraceSpansContent(traceSpans, (value) => assertNoPlaintext(value, context, contentState))
}

function collectPostTransformLargeValues(
  value: unknown,
  context: PostTransformInvariantContext,
  refs: object[],
  depth = 0
): void {
  if (depth === 0) {
    assertNoPlaintext(value, context.plaintext, context.contentState)
  }

  visitNode(context.collectionState, depth)
  const largeValue = getLargeValueCandidate(value)
  if (largeValue) {
    const objectValue = value as object
    if (context.collectionSeen.has(objectValue)) return
    context.collectionSeen.add(objectValue)
    refs.push(objectValue)

    if (isLargeValueRef(largeValue)) {
      const preview = readOwnDataProperty(largeValue, 'preview')
      if (preview !== undefined) {
        collectPostTransformLargeValues(preview, context, refs, depth + 1)
      }
    } else {
      collectPostTransformLargeValues(largeValue.preview, context, refs, depth + 1)
      for (const chunk of largeValue.chunks) {
        collectPostTransformLargeValues(chunk.ref, context, refs, depth + 1)
      }
    }
    return
  }

  if (value === null || typeof value !== 'object') return
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    throw new TraceSecretProjectionError('Trace invariant contains an unsupported object')
  }
  if (context.collectionSeen.has(value)) return
  context.collectionSeen.add(value)

  enterObject(value, context.collectionState)
  try {
    if (Array.isArray(value)) {
      assertArrayFitsTraversal(value, context.collectionState)
      for (const [, item] of arrayDataEntries(value)) {
        collectPostTransformLargeValues(item, context, refs, depth + 1)
      }
      return
    }
    for (const [, item] of enumerableDataEntries(value)) {
      collectPostTransformLargeValues(item, context, refs, depth + 1)
    }
  } finally {
    leaveObject(value, context.collectionState)
  }
}

async function verifyPostTransformValue(
  value: unknown,
  context: PostTransformInvariantContext,
  path: ReadonlySet<string>
): Promise<void> {
  const refs: object[] = []
  collectPostTransformLargeValues(value, context, refs)
  await verifyPostTransformLargeValues(refs, context, path)
}

async function verifyPostTransformLargeValue(
  value: LargeValueCandidate,
  context: PostTransformInvariantContext,
  path: ReadonlySet<string>
): Promise<unknown> {
  const key = getLargeValueKey(value, context.projection)
  const nextPath = extendLargeValuePath(path, key)
  registerSourceLargeValue(value, key, context.projection)
  const cached = context.verificationCache.get(key)
  if (cached) return cached

  const verification = (async (): Promise<unknown> => {
    if (isLargeValueRef(value)) {
      const preview = readOwnDataProperty(value, 'preview')
      if (preview !== undefined) {
        await verifyPostTransformValue(preview, context, nextPath)
      }
      const materialized = await materializeSourceRef(value, context.projection)
      await verifyPostTransformValue(materialized, context, nextPath)
      return materialized
    }

    await verifyPostTransformValue(value.preview, context, nextPath)
    for (const chunk of value.chunks) {
      const materialized = await verifyPostTransformLargeValue(chunk.ref, context, nextPath)
      if (!Array.isArray(materialized) || materialized.length !== chunk.count) {
        throw new TraceSecretProjectionError('Trace invariant manifest chunk is invalid')
      }
    }
    return value
  })()
  context.verificationCache.set(key, verification)
  return verification
}

async function verifyPostTransformLargeValues(
  refs: object[],
  context: PostTransformInvariantContext,
  path: ReadonlySet<string>
): Promise<void> {
  const candidates = new Map<string, LargeValueCandidate>()
  for (const ref of refs) {
    const candidate = getLargeValueCandidate(ref)
    if (!candidate) {
      throw new TraceSecretProjectionError('Trace invariant large-value metadata changed')
    }
    const key = getLargeValueKey(candidate, context.projection)
    const current = candidates.get(key)
    if (
      current &&
      isLargeValueRef(current) &&
      isLargeValueRef(candidate) &&
      current.size !== candidate.size
    ) {
      throw new TraceSecretProjectionError('Trace invariant ref metadata is inconsistent')
    }
    if (!current) candidates.set(key, candidate)
    if (candidates.size > MAX_LARGE_VALUES) {
      throw new TraceSecretProjectionError('Trace invariant large-value count exceeded')
    }
  }

  await Promise.all(
    [...candidates.values()].map((candidate) =>
      verifyPostTransformLargeValue(candidate, context, path)
    )
  )
}

async function assertPostTransformTraceSpansAreSafe(
  traceSpans: TraceSpan[],
  matcher: ResolvedSecretMatcher,
  store: LargeValueStoreContext
): Promise<void> {
  const projection = createProjectionContext(matcher, store, false)
  const context: PostTransformInvariantContext = {
    projection,
    plaintext: {
      matcher,
      safeLargeValues: new WeakSet<object>(),
      allowVerifiedLargeValues: true,
      inspectLargeValuePreviews: true,
    },
    contentState: { nodes: 0, ancestors: new WeakSet<object>() },
    collectionState: { nodes: 0, ancestors: new WeakSet<object>() },
    collectionSeen: new WeakSet<object>(),
    verificationCache: new Map<string, Promise<unknown>>(),
  }
  const refs: object[] = []
  visitTraceSpansContent(traceSpans, (value) =>
    collectPostTransformLargeValues(value, context, refs)
  )
  await verifyPostTransformLargeValues(refs, context, new Set<string>())
}

export interface EnforceTraceSpanSecretInvariantOptions {
  registry?: ResolvedSecretTraceRegistry
  store: LargeValueStoreContext
}

/**
 * Re-checks an already-projected TraceSpan tree after generic log transforms.
 * Inline content and hydrated trace-owned refs are inspected without performing
 * replacement or storage work. The caller must pass the output of
 * {@link projectTraceSpansForSecrets} through directly.
 */
export async function enforceTraceSpanSecretInvariant(
  traceSpans: TraceSpan[],
  options: EnforceTraceSpanSecretInvariantOptions
): Promise<TraceSpan[]> {
  try {
    if (!options.registry?.isComplete()) return structuralOnlyTraceSpans(traceSpans)

    const matcher = createResolvedSecretMatcher(options.registry.getActiveMatches(), {
      preserveNamedProvenanceLabels: true,
    })
    if (!matcher) return traceSpans

    await assertPostTransformTraceSpansAreSafe(traceSpans, matcher, options.store)
    return traceSpans
  } catch (error) {
    logger.warn('Trace secret invariant failed; retaining structural spans only', {
      failure: describeProjectionFailure(error),
    })
    return structuralOnlyTraceSpans(traceSpans)
  }
}

/**
 * Produces the only Secrets-feature-safe representation of execution TraceSpans.
 * Runtime logs and outputs remain untouched; only schema-defined trace content is copied.
 */
export async function projectTraceSpansForSecrets(
  traceSpans: TraceSpan[],
  options: ProjectTraceSpansForSecretsOptions
): Promise<TraceSpan[]> {
  if (!options.registry?.isComplete()) {
    return structuralOnlyTraceSpans(traceSpans)
  }

  try {
    const matcher = createResolvedSecretMatcher(options.registry.getActiveMatches(), {
      preserveNamedProvenanceLabels: true,
    })
    if (!matcher) return cloneTraceSpansForProjection(traceSpans)

    const context = createProjectionContext(
      matcher,
      options.store,
      options.allowLargeValueWrites !== false
    )

    const projected: TraceSpan[] = []
    const state: BoundedTraceStructureState = { nodes: 0, truncated: false }
    assertTraceStructureArrayFits(traceSpans, state)
    for (const span of traceSpans) {
      projected.push(await sanitizeTraceSpan(span, context, 0, state))
    }
    assertTraceSpansContentIsSafe(projected, context)
    return projected
  } catch (error) {
    logger.warn('Trace secret projection failed; retaining structural spans only', {
      failure: describeProjectionFailure(error),
    })
    return structuralOnlyTraceSpans(traceSpans)
  }
}
