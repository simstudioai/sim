import { isPlainRecord } from '@sim/utils/object'
import { LARGE_ARRAY_MANIFEST_MARKER } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { LARGE_VALUE_REF_MARKER } from '@/lib/execution/payloads/large-value-ref'
import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/materialization.server'
import type { ResolvedSecretTraceMatch } from '@/executor/utils/resolved-secret-trace-registry'

const MAX_CONTENT_NODES = 100_000
const MAX_CONTENT_DEPTH = 100
const MAX_MATCHER_NODES = 250_000
const MAX_SECRET_LITERAL_LENGTH = 64 * 1024
const MAX_MATCH_EVENTS = 1_000_000

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

export interface ResolvedSecretMatcher {
  root: SecretTrieNode
  maxPatternLength: number
}

interface ProjectionState {
  nodes: number
  ancestors: WeakSet<object>
  outputBytes: number
  maxBytes: number
}

export interface ResolvedSecretContentProjectionOptions {
  /** Values already materialized and verified by a boundary-specific projector. */
  isOpaqueSafeObject?: (value: object) => boolean
}

export type ResolvedSecretContentProjection = { safe: true; value: unknown } | { safe: false }

class ResolvedSecretContentProjectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResolvedSecretContentProjectionError'
  }
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function createMatcherFromReplacements(
  replacements: readonly SecretReplacement[]
): ResolvedSecretMatcher {
  const root: SecretTrieNode = { children: new Map<string, SecretTrieNode>() }
  root.failure = root
  let nodeCount = 1
  let maxPatternLength = 0

  for (const replacement of replacements) {
    if (replacement.plaintext.length > MAX_SECRET_LITERAL_LENGTH) {
      throw new ResolvedSecretContentProjectionError(
        'Secret literal exceeds the matcher size limit'
      )
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
          throw new ResolvedSecretContentProjectionError('Secret matcher node limit exceeded')
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
  matcher: ResolvedSecretMatcher,
  node: SecretTrieNode,
  character: string
): SecretTrieNode {
  let current = node
  while (current !== matcher.root && !current.children.has(character)) {
    current = current.failure ?? matcher.root
  }
  return current.children.get(character) ?? matcher.root
}

export function containsResolvedSecret(value: string, matcher: ResolvedSecretMatcher): boolean {
  let node = matcher.root
  for (let index = 0; index < value.length; index += 1) {
    node = advanceMatcher(matcher, node, value[index])
    if (node.replacement || node.outputLink) return true
  }
  return false
}

export function sanitizeResolvedSecretString(
  value: string,
  matcher: ResolvedSecretMatcher,
  maxBytes = MAX_INLINE_MATERIALIZATION_BYTES
): string {
  if (maxBytes < 0) {
    throw new ResolvedSecretContentProjectionError(
      'Sanitized secret-bearing string exceeds the size limit'
    )
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new ResolvedSecretContentProjectionError('Secret-bearing string exceeds the size limit')
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
      throw new ResolvedSecretContentProjectionError(
        'Sanitized secret-bearing string exceeds the size limit'
      )
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
        throw new ResolvedSecretContentProjectionError('Secret matcher event limit exceeded')
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
  const sanitized = chunks.join('')
  if (containsResolvedSecret(sanitized, matcher)) {
    throw new ResolvedSecretContentProjectionError(
      'Sanitized content still contains an active secret'
    )
  }
  return sanitized
}

export function createResolvedSecretMatcher(
  matches: readonly ResolvedSecretTraceMatch[]
): ResolvedSecretMatcher | undefined {
  const replacementByPlaintext = new Map<string, string>()

  for (const match of matches) {
    if (!match.plaintext) continue
    const current = replacementByPlaintext.get(match.plaintext)
    if (current === undefined || compareStrings(match.replacement, current) < 0) {
      replacementByPlaintext.set(match.plaintext, match.replacement)
    }
  }

  const provisional = [...replacementByPlaintext.keys()]
    .map((plaintext) => ({
      plaintext,
      replacement: replacementByPlaintext.get(plaintext) ?? '',
    }))
    .sort(
      (left, right) =>
        right.plaintext.length - left.plaintext.length ||
        compareStrings(left.replacement, right.replacement) ||
        compareStrings(left.plaintext, right.plaintext)
    )

  if (provisional.length === 0) return undefined

  const detector = createMatcherFromReplacements(
    provisional.map(({ plaintext }) => ({ plaintext, replacement: '' }))
  )
  return createMatcherFromReplacements(
    provisional.map(({ plaintext, replacement }) => ({
      plaintext,
      replacement: containsResolvedSecret(replacement, detector) ? '' : replacement,
    }))
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
  matcher: ResolvedSecretMatcher,
  state: ProjectionState,
  options: ResolvedSecretContentProjectionOptions,
  depth = 0
): unknown {
  visitNode(state, depth)
  if (typeof value === 'string') {
    const sanitized = sanitizeResolvedSecretString(
      value,
      matcher,
      state.maxBytes - state.outputBytes
    )
    state.outputBytes += Buffer.byteLength(sanitized, 'utf8')
    return sanitized
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    const rendered = String(value)
    if (!containsResolvedSecret(rendered, matcher)) return value
    const sanitized = sanitizeResolvedSecretString(
      rendered,
      matcher,
      state.maxBytes - state.outputBytes
    )
    state.outputBytes += Buffer.byteLength(sanitized, 'utf8')
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
      const sanitizedKey = sanitizeResolvedSecretString(
        key,
        matcher,
        state.maxBytes - state.outputBytes
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

export function projectResolvedSecretContent(
  value: unknown,
  matcher: ResolvedSecretMatcher,
  maxBytes = MAX_INLINE_MATERIALIZATION_BYTES,
  options: ResolvedSecretContentProjectionOptions = {}
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
