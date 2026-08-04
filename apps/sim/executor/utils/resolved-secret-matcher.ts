import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/materialization.server'
import { getResolvedSecretMatcherCapacityFailure } from '@/executor/utils/resolved-secret-matcher-capacity'

const MAX_MATCH_EVENTS = 1_000_000

export const OPAQUE_RESOLVED_SECRET_REPLACEMENT = '[REDACTED_SECRET]'

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

export interface ResolvedSecretMatch {
  plaintext: string
  replacement: string
}

export interface ResolvedSecretMatcher {
  root: SecretTrieNode
  maxPatternLength: number
  exactReplacements: ReadonlyMap<string, string>
}

class ResolvedSecretMatcherError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResolvedSecretMatcherError'
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
  let maxPatternLength = 0

  for (const replacement of replacements) {
    maxPatternLength = Math.max(maxPatternLength, replacement.plaintext.length)
    let node = root
    for (let index = 0; index < replacement.plaintext.length; index += 1) {
      const character = replacement.plaintext[index]
      let child = node.children.get(character)
      if (!child) {
        child = { children: new Map<string, SecretTrieNode>() }
        node.children.set(character, child)
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

  return {
    root,
    maxPatternLength,
    exactReplacements: new Map(
      replacements.map(({ plaintext, replacement }) => [plaintext, replacement])
    ),
  }
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

/** Visits exact secret literals with the same bounded automaton used by content projection. */
export function scanResolvedSecretString(
  value: string,
  matcher: ResolvedSecretMatcher,
  onMatch: (plaintext: string) => void,
  maxMatchEvents = MAX_MATCH_EVENTS
): number {
  let node = matcher.root
  let matchEvents = 0
  for (let index = 0; index < value.length; index += 1) {
    node = advanceMatcher(matcher, node, value[index])
    let outputNode: SecretTrieNode | undefined = node.replacement ? node : node.outputLink
    while (outputNode?.replacement) {
      matchEvents += 1
      if (matchEvents > maxMatchEvents) {
        throw new ResolvedSecretMatcherError('Secret matcher event limit exceeded')
      }
      onMatch(outputNode.replacement.plaintext)
      outputNode = outputNode.outputLink
    }
  }
  return matchEvents
}

export function sanitizeResolvedSecretString(
  value: string,
  matcher: ResolvedSecretMatcher,
  maxBytes = MAX_INLINE_MATERIALIZATION_BYTES,
  onMatch?: (plaintext: string) => void
): string {
  if (maxBytes < 0) {
    throw new ResolvedSecretMatcherError('Sanitized secret-bearing string exceeds the size limit')
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new ResolvedSecretMatcherError('Secret-bearing string exceeds the size limit')
  }
  if (matcher.maxPatternLength === 0 || value.length === 0) return value

  let emitCursor = 0
  let literalStart = 0
  let outputBytes = 0
  let matchEvents = 0
  const chunks: string[] = []
  const windowSize = Math.min(matcher.maxPatternLength, value.length)
  const slotStarts = new Int32Array(windowSize)
  const slotEnds = new Int32Array(windowSize)
  slotStarts.fill(-1)
  const slotReplacements = new Array<string | undefined>(windowSize)

  const append = (chunk: string): void => {
    if (!chunk) return
    outputBytes += Buffer.byteLength(chunk, 'utf8')
    if (outputBytes > maxBytes) {
      throw new ResolvedSecretMatcherError('Sanitized secret-bearing string exceeds the size limit')
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
      onMatch?.(outputNode.replacement.plaintext)
      matchEvents += 1
      if (matchEvents > MAX_MATCH_EVENTS) {
        throw new ResolvedSecretMatcherError('Secret matcher event limit exceeded')
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
    throw new ResolvedSecretMatcherError('Sanitized content still contains an active secret')
  }
  return sanitized
}

/** Replaces only an exact primitive rendering, never a substring of another primitive. */
export function sanitizeResolvedSecretPrimitive(
  value: string,
  matcher: ResolvedSecretMatcher,
  onMatch?: (plaintext: string) => void
): string | undefined {
  const replacement = matcher.exactReplacements.get(value)
  if (replacement === undefined) return undefined
  onMatch?.(value)
  return replacement
}

export function createResolvedSecretMatcher(
  matches: readonly ResolvedSecretMatch[]
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

  const capacityFailure = getResolvedSecretMatcherCapacityFailure(
    provisional.map(({ plaintext }) => plaintext)
  )
  if (capacityFailure === 'literal-too-long') {
    throw new ResolvedSecretMatcherError('Secret literal exceeds the matcher size limit')
  }
  if (capacityFailure === 'node-limit-exceeded') {
    throw new ResolvedSecretMatcherError('Secret matcher node limit exceeded')
  }

  const detector = createMatcherFromReplacements(
    provisional.map(({ plaintext }) => ({ plaintext, replacement: '' }))
  )
  const exactReplacements = new Map<string, string>()
  for (const { plaintext, replacement } of provisional) {
    let node = detector.root
    for (const character of plaintext) {
      const child = node.children.get(character)
      if (!child) throw new ResolvedSecretMatcherError('Secret matcher construction failed')
      node = child
    }
    const safeReplacement = containsResolvedSecret(replacement, detector)
      ? containsResolvedSecret(OPAQUE_RESOLVED_SECRET_REPLACEMENT, detector)
        ? ''
        : OPAQUE_RESOLVED_SECRET_REPLACEMENT
      : replacement
    node.replacement = {
      plaintext,
      replacement: safeReplacement,
    }
    exactReplacements.set(plaintext, safeReplacement)
  }
  detector.exactReplacements = exactReplacements
  return detector
}
