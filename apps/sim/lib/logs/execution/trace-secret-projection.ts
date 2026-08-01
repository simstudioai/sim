import { createLogger } from '@sim/logger'
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
} from '@/lib/execution/payloads/materialization.server'
import type { LargeValueStoreContext } from '@/lib/execution/payloads/store'
import { materializeLargeValueRef, storeLargeValue } from '@/lib/execution/payloads/store'
import type { ToolCall, TraceSpan } from '@/lib/logs/types'
import type { IterationToolCall, ProviderTimingSegment } from '@/executor/types'
import type {
  ResolvedSecretTraceMatch,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('TraceSecretProjection')
const REF_CONCURRENCY = 4
const MAX_CONTENT_NODES = 100_000
const MAX_CONTENT_DEPTH = 100
const MAX_MATCHER_NODES = 250_000
const MAX_SECRET_LITERAL_LENGTH = 64 * 1024
const MAX_MATCH_EVENTS = 1_000_000
const MAX_LARGE_VALUES = 1_024
const MAX_LARGE_VALUE_CHAIN_DEPTH = 32
const MAX_LARGE_MANIFEST_CHUNKS = MAX_LARGE_VALUES
const MAX_LARGE_MANIFEST_ITEMS = MAX_CONTENT_NODES
const OMIT = Symbol('omit-trace-content')

interface SecretReplacement {
  plaintext: string
  replacement: string
}

interface SecretTrieNode {
  children: Map<string, SecretTrieNode>
  failure?: SecretTrieNode
  outputLink?: SecretTrieNode
  replacement?: SecretReplacement
}

interface SecretMatcher {
  root: SecretTrieNode
  maxPatternLength: number
}

interface ProjectionContext {
  matcher: SecretMatcher
  store: LargeValueStoreContext
  allowLargeValueWrites: boolean
  safeLargeValues: WeakSet<object>
  oversizedGate: OversizedHydrationGate
  refIoSemaphore: AsyncSemaphore
  seenLargeValues: Set<string>
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

interface SanitizationTraversalState extends TraversalState {
  outputBytes: number
  maxBytes: number
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

function compareStrings(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function normalizeReplacements(matches: readonly ResolvedSecretTraceMatch[]): SecretReplacement[] {
  const replacementByPlaintext = new Map<string, string>()

  for (const match of matches) {
    if (!match.plaintext) continue
    const current = replacementByPlaintext.get(match.plaintext)
    if (current === undefined || compareStrings(match.replacement, current) < 0) {
      replacementByPlaintext.set(match.plaintext, match.replacement)
    }
  }

  const provisional = [...replacementByPlaintext.keys()]
    .map((plaintext) => {
      const requested = replacementByPlaintext.get(plaintext) ?? ''
      return { plaintext, replacement: requested }
    })
    .sort(
      (left, right) =>
        right.plaintext.length - left.plaintext.length ||
        compareStrings(left.replacement, right.replacement) ||
        compareStrings(left.plaintext, right.plaintext)
    )

  const detector = createSecretMatcher(
    provisional.map(({ plaintext }) => ({ plaintext, replacement: '' }))
  )
  return provisional.map(({ plaintext, replacement }) => ({
    plaintext,
    replacement: containsSecret(replacement, detector) ? '' : replacement,
  }))
}

function createSecretMatcher(replacements: readonly SecretReplacement[]): SecretMatcher {
  const root: SecretTrieNode = { children: new Map<string, SecretTrieNode>() }
  root.failure = root
  let nodeCount = 1
  let maxPatternLength = 0
  for (const replacement of replacements) {
    if (replacement.plaintext.length > MAX_SECRET_LITERAL_LENGTH) {
      throw new TraceSecretProjectionError('Secret literal exceeds the matcher size limit')
    }
    maxPatternLength = Math.max(maxPatternLength, replacement.plaintext.length)
    let node = root
    for (let index = 0; index < replacement.plaintext.length; index += 1) {
      const character = replacement.plaintext[index]
      let child = node.children.get(character)
      if (!child) {
        child = { children: new Map<string, SecretTrieNode>() }
        node.children.set(character, child)
        nodeCount += 1
        if (nodeCount > MAX_MATCHER_NODES) {
          throw new TraceSecretProjectionError('Secret matcher node limit exceeded')
        }
      }
      node = child
    }
    node.replacement = replacement
  }

  const queue: SecretTrieNode[] = []
  for (const child of root.children.values()) {
    child.failure = root
    queue.push(child)
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const node = queue[cursor]
    for (const [character, child] of node.children) {
      let fallback = node.failure ?? root
      while (fallback !== root && !fallback.children.has(character)) {
        fallback = fallback.failure ?? root
      }
      const transition = fallback.children.get(character)
      child.failure = transition && transition !== child ? transition : root
      child.outputLink = child.failure.replacement ? child.failure : child.failure.outputLink
      queue.push(child)
    }
  }

  return { root, maxPatternLength }
}

function advanceMatcher(
  matcher: SecretMatcher,
  node: SecretTrieNode,
  character: string
): SecretTrieNode {
  let current = node
  while (current !== matcher.root && !current.children.has(character)) {
    current = current.failure ?? matcher.root
  }
  return current.children.get(character) ?? matcher.root
}

function containsSecret(value: string, matcher: SecretMatcher): boolean {
  let node = matcher.root
  for (let index = 0; index < value.length; index += 1) {
    node = advanceMatcher(matcher, node, value[index])
    if (node.replacement || node.outputLink) return true
  }
  return false
}

function sanitizeString(
  value: string,
  matcher: SecretMatcher,
  maxBytes = MAX_INLINE_MATERIALIZATION_BYTES
): string {
  if (maxBytes < 0) {
    throw new TraceSecretProjectionError('Sanitized trace string exceeds the size limit')
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new TraceSecretProjectionError('Trace string exceeds the size limit')
  }
  if (matcher.maxPatternLength === 0 || value.length === 0) return value

  let emitCursor = 0
  let literalStart = 0
  let outputBytes = 0
  let matchEvents = 0
  const chunks: string[] = []
  const windowSize = matcher.maxPatternLength
  const slotStarts = new Int32Array(windowSize)
  const slotEnds = new Int32Array(windowSize)
  slotStarts.fill(-1)
  const slotReplacements = new Array<string | undefined>(windowSize)

  const append = (chunk: string): void => {
    if (!chunk) return
    outputBytes += Buffer.byteLength(chunk, 'utf8')
    if (outputBytes > maxBytes) {
      throw new TraceSecretProjectionError('Sanitized trace string exceeds the size limit')
    }
    const lastIndex = chunks.length - 1
    if (lastIndex >= 0 && chunks[lastIndex].length + chunk.length <= 64 * 1024) {
      chunks[lastIndex] += chunk
    } else {
      chunks.push(chunk)
    }
  }

  const finalizeThrough = (limit: number): void => {
    while (emitCursor <= limit && emitCursor < value.length) {
      const slot = emitCursor % windowSize
      if (slotStarts[slot] === emitCursor && slotReplacements[slot] !== undefined) {
        append(value.slice(literalStart, emitCursor))
        append(slotReplacements[slot] ?? '')
        emitCursor = slotEnds[slot]
        literalStart = emitCursor
      } else {
        emitCursor += 1
      }
    }
  }

  let node = matcher.root
  for (let index = 0; index < value.length; index += 1) {
    node = advanceMatcher(matcher, node, value[index])
    let outputNode: SecretTrieNode | undefined = node.replacement ? node : node.outputLink
    while (outputNode?.replacement) {
      matchEvents += 1
      if (matchEvents > MAX_MATCH_EVENTS) {
        throw new TraceSecretProjectionError('Secret matcher event limit exceeded')
      }
      const start = index - outputNode.replacement.plaintext.length + 1
      if (start >= emitCursor) {
        const slot = start % windowSize
        const end = index + 1
        if (slotStarts[slot] !== start || end > slotEnds[slot]) {
          slotStarts[slot] = start
          slotEnds[slot] = end
          slotReplacements[slot] = outputNode.replacement.replacement
        }
      }
      outputNode = outputNode.outputLink
    }
    finalizeThrough(index - matcher.maxPatternLength + 1)
  }

  finalizeThrough(value.length - 1)
  append(value.slice(literalStart))
  return chunks.join('')
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

function* arrayDataEntries(value: readonly unknown[]): Generator<[number, unknown]> {
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index)
    if (!descriptor) continue
    if (!('value' in descriptor)) {
      throw new TraceSecretProjectionError('Trace content accessors are not supported')
    }
    yield [index, descriptor.value]
  }
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
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable) continue
    if (!('value' in descriptor)) {
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

function getLargeValueCandidate(value: unknown): LargeValueCandidate | undefined {
  if (!value || typeof value !== 'object') return undefined

  const largeValueMarker = readOwnDataProperty(value, LARGE_VALUE_REF_MARKER)
  const manifestMarker = readOwnDataProperty(value, LARGE_ARRAY_MANIFEST_MARKER)
  if (largeValueMarker === true && manifestMarker === true) {
    throw new TraceSecretProjectionError('Trace content has ambiguous large-value metadata')
  }
  if (largeValueMarker === true) {
    if (!isLargeValueRef(value) || value.size > MAX_DURABLE_LARGE_VALUE_BYTES) {
      throw new TraceSecretProjectionError('Trace content has invalid large-value metadata')
    }
    return value
  }
  if (manifestMarker !== true) return undefined

  const chunks = readOwnDataProperty(value, 'chunks')
  const chunkCount = readOwnDataProperty(value, 'chunkCount')
  const totalCount = readOwnDataProperty(value, 'totalCount')
  const byteSize = readOwnDataProperty(value, 'byteSize')
  if (
    !Array.isArray(chunks) ||
    chunks.length > MAX_LARGE_MANIFEST_CHUNKS ||
    chunkCount !== chunks.length ||
    typeof totalCount !== 'number' ||
    totalCount > MAX_LARGE_MANIFEST_ITEMS ||
    typeof byteSize !== 'number' ||
    byteSize > MAX_DURABLE_LARGE_VALUE_BYTES ||
    !isLargeArrayManifest(value)
  ) {
    throw new TraceSecretProjectionError('Trace content has invalid large-array metadata')
  }
  return value
}

function sanitizeInlineValue(
  value: unknown,
  matcher: SecretMatcher,
  safeLargeValues: WeakSet<object>,
  state: SanitizationTraversalState,
  depth = 0
): unknown {
  visitNode(state, depth)
  if (typeof value === 'string') {
    const sanitized = sanitizeString(value, matcher, state.maxBytes - state.outputBytes)
    state.outputBytes += Buffer.byteLength(sanitized, 'utf8')
    return sanitized
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    const rendered = String(value)
    if (!containsSecret(rendered, matcher)) return value
    const sanitized = sanitizeString(rendered, matcher, state.maxBytes - state.outputBytes)
    state.outputBytes += Buffer.byteLength(sanitized, 'utf8')
    return sanitized
  }
  if (value === undefined) return value
  if (typeof value !== 'object') {
    throw new TraceSecretProjectionError('Unsupported trace content value')
  }
  const largeValue = getLargeValueCandidate(value)
  if (largeValue) {
    if (!safeLargeValues.has(value as object)) {
      throw new TraceSecretProjectionError('Trace content contains an unverified large value')
    }
    return value
  }
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    throw new TraceSecretProjectionError('Unsupported trace content object')
  }

  enterObject(value, state)
  try {
    if (Array.isArray(value)) {
      assertArrayFitsTraversal(value, state)
      const sanitized = new Array<unknown>(value.length)
      for (const [index, item] of arrayDataEntries(value)) {
        sanitized[index] = sanitizeInlineValue(item, matcher, safeLargeValues, state, depth + 1)
      }
      return sanitized
    }

    const prototype = Object.getPrototypeOf(value)
    const sanitized = Object.create(prototype) as Record<string, unknown>
    const sanitizedKeys = new Set<string>()
    for (const [key, item] of enumerableDataEntries(value)) {
      const sanitizedKey = sanitizeString(key, matcher, state.maxBytes - state.outputBytes)
      state.outputBytes += Buffer.byteLength(sanitizedKey, 'utf8')
      if (sanitizedKeys.has(sanitizedKey)) {
        throw new TraceSecretProjectionError('Secret replacement caused an object-key collision')
      }
      sanitizedKeys.add(sanitizedKey)
      Object.defineProperty(sanitized, sanitizedKey, {
        value: sanitizeInlineValue(item, matcher, safeLargeValues, state, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    return sanitized
  } finally {
    leaveObject(value, state)
  }
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
  context: ProjectionContext,
  countBytes = true
): void {
  if (context.seenLargeValues.has(key)) return
  const size = countBytes ? (isLargeValueRef(value) ? value.size : value.byteSize) : 0
  if (
    context.largeValueCount + 1 > MAX_LARGE_VALUES ||
    context.sourceLargeValueBytes + size > MAX_DURABLE_LARGE_VALUE_BYTES
  ) {
    throw new TraceSecretProjectionError('Trace large-value projection budget exceeded')
  }
  context.seenLargeValues.add(key)
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
  return sanitizeInlineValue(withSafeRefs, context.matcher, context.safeLargeValues, {
    nodes: 0,
    ancestors: new WeakSet<object>(),
    outputBytes: 0,
    maxBytes,
  })
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
    registerSourceLargeValue(chunk.ref, chunkKey, context, false)
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
  const cached = context.largeValueCache.get(key)
  if (cached) return cached

  registerSourceLargeValue(value, key, context)
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
  } catch {
    logger.warn('Omitting trace content that could not be sanitized')
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

  let projected: TraceSpan = { ...span }

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
  return {
    ...span,
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
  } catch {
    logger.warn('Trace structure could not be safely traversed; omitting projected spans')
    return []
  }
}

function cloneTraceSpansForProjection(traceSpans: TraceSpan[]): TraceSpan[] {
  return projectBoundedTraceSpans(traceSpans, cloneTraceSpanForProjection)
}

function assertNoPlaintext(
  value: unknown,
  context: ProjectionContext,
  state: TraversalState,
  depth = 0
): void {
  visitNode(state, depth)
  if (typeof value === 'string') {
    if (containsSecret(value, context.matcher)) {
      throw new TraceSecretProjectionError('Sanitized trace content still contains a secret')
    }
    return
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    if (containsSecret(String(value), context.matcher)) {
      throw new TraceSecretProjectionError('Sanitized trace primitive still contains a secret')
    }
    return
  }
  if (getLargeValueCandidate(value)) {
    if (!context.safeLargeValues.has(value as object)) {
      throw new TraceSecretProjectionError('Sanitized trace content contains an unverified ref')
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
      if (containsSecret(key, context.matcher)) {
        throw new TraceSecretProjectionError('Sanitized trace key still contains a secret')
      }
      assertNoPlaintext(item, context, state, depth + 1)
    }
  } finally {
    leaveObject(value, state)
  }
}

function assertTraceSpanContentIsSafe(span: TraceSpan, context: ProjectionContext): void {
  const assertField = (value: unknown): void => {
    if (value === undefined) return
    assertNoPlaintext(value, context, { nodes: 0, ancestors: new WeakSet<object>() })
  }

  assertField(span.input)
  assertField(span.output)
  assertField(span.thinking)
  assertField(span.errorMessage)
  if (span.modelToolCalls) {
    for (const call of span.modelToolCalls) {
      if (Object.hasOwn(call, 'arguments')) assertField(call.arguments)
    }
  }
  if (span.toolCalls) {
    for (const call of span.toolCalls) {
      assertField(call.input)
      assertField(call.output)
      assertField(call.error)
    }
  }
  if (span.providerTiming) {
    for (const segment of span.providerTiming.segments) {
      assertField(segment.assistantContent)
      assertField(segment.thinkingContent)
      assertField(segment.errorMessage)
      for (const call of segment.toolCalls ?? []) {
        if (Object.hasOwn(call, 'arguments')) assertField(call.arguments)
      }
    }
  }
  for (const child of span.children ?? []) assertTraceSpanContentIsSafe(child, context)
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
    const replacements = normalizeReplacements(options.registry.getActiveMatches())
    if (replacements.length === 0) return cloneTraceSpansForProjection(traceSpans)

    const context: ProjectionContext = {
      matcher: createSecretMatcher(replacements),
      store: options.store,
      allowLargeValueWrites: options.allowLargeValueWrites !== false,
      safeLargeValues: new WeakSet<object>(),
      oversizedGate: { chain: Promise.resolve() },
      refIoSemaphore: { active: 0, waiters: [] },
      seenLargeValues: new Set<string>(),
      largeValueCache: new Map<string, Promise<unknown>>(),
      manifestIds: new WeakMap<object, string>(),
      nextManifestId: 0,
      largeValueCount: 0,
      sourceLargeValueBytes: 0,
      storedLargeValueBytes: 0,
      storedLargeValueCount: 0,
    }

    const projected: TraceSpan[] = []
    const state: BoundedTraceStructureState = { nodes: 0, truncated: false }
    assertTraceStructureArrayFits(traceSpans, state)
    for (const span of traceSpans) {
      projected.push(await sanitizeTraceSpan(span, context, 0, state))
    }
    for (const span of projected) assertTraceSpanContentIsSafe(span, context)
    return projected
  } catch {
    logger.warn('Trace secret projection failed; retaining structural spans only')
    return structuralOnlyTraceSpans(traceSpans)
  }
}
