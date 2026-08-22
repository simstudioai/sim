import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'
import { isNonIdentifyingSecretLiteral } from '@/executor/utils/resolved-secret-match-policy'
import { getResolvedSecretMatcherCapacityFailure } from '@/executor/utils/resolved-secret-matcher-capacity'

const MAX_MATCH_EVENTS = 1_000_000

/** Bounds the substitute/verify loop in {@link sanitizeResolvedSecretString}. */
const MAX_SETTLE_PASSES = 4

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
  protectedReplacementPlaintexts: ReadonlyMap<string, ReadonlySet<string>>
  protectedReplacementMatcher?: ResolvedSecretMatcher
}

export interface CreateResolvedSecretMatcherOptions {
  /**
   * Treats canonical `{{NAME}}` replacements as atomic provenance labels. A label protects only
   * the exact plaintext that produced it; overlapping secret literals remain detectable.
   */
  preserveNamedProvenanceLabels?: boolean
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
    protectedReplacementPlaintexts: new Map<string, ReadonlySet<string>>(),
  }
}

/** Walks by code unit, matching how {@link createMatcherFromReplacements} keys the trie. */
function findTerminalNode(root: SecretTrieNode, plaintext: string): SecretTrieNode {
  let node = root
  for (let index = 0; index < plaintext.length; index += 1) {
    const child = node.children.get(plaintext[index])
    if (!child) throw new ResolvedSecretMatcherError('Secret matcher construction failed')
    node = child
  }
  return node
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

function isNamedResolvedSecretReplacement(value: string): boolean {
  const match = /^\{\{([^{}]+)\}\}$/.exec(value)
  return match !== null && match[1].trim().length > 0
}

interface ProtectedReplacementSpan {
  start: number
  end: number
  plaintexts: ReadonlySet<string>
}

function createProtectedReplacementMatcher(
  protectedReplacementPlaintexts: ReadonlyMap<string, ReadonlySet<string>>
): ResolvedSecretMatcher | undefined {
  const replacements = [...protectedReplacementPlaintexts.keys()]
  if (
    replacements.length === 0 ||
    getResolvedSecretMatcherCapacityFailure(replacements) !== undefined
  ) {
    return undefined
  }
  return createMatcherFromReplacements(
    replacements.map((replacement) => ({ plaintext: replacement, replacement: '' }))
  )
}

function* iterateProtectedReplacementSpans(
  value: string,
  matcher: ResolvedSecretMatcher
): Generator<ProtectedReplacementSpan> {
  const replacementMatcher = matcher.protectedReplacementMatcher
  if (!replacementMatcher) return

  let node = replacementMatcher.root
  for (let index = 0; index < value.length; index += 1) {
    node = advanceMatcher(replacementMatcher, node, value[index])
    const outputNode = node.replacement ? node : node.outputLink
    const replacement = outputNode?.replacement?.plaintext
    if (!replacement) continue

    const plaintexts = matcher.protectedReplacementPlaintexts.get(replacement)
    if (!plaintexts) continue
    yield {
      start: index - replacement.length + 1,
      end: index + 1,
      plaintexts,
    }
  }
}

function isMatchInsideProtectedReplacement(
  start: number,
  end: number,
  plaintext: string,
  protectedStart: number,
  protectedEnd: number,
  protectedPlaintexts: ReadonlySet<string> | undefined
): boolean {
  return (
    protectedStart >= 0 &&
    start >= protectedStart &&
    end <= protectedEnd &&
    protectedPlaintexts?.has(plaintext) === true
  )
}

/** Detects secret literals except those wholly contained by a matcher-issued named placeholder. */
export function containsResolvedSecret(value: string, matcher: ResolvedSecretMatcher): boolean {
  let node = matcher.root
  const protectedSpans = iterateProtectedReplacementSpans(value, matcher)
  let protectedSpan = protectedSpans.next().value
  let matchEvents = 0
  for (let index = 0; index < value.length; index += 1) {
    while (protectedSpan && protectedSpan.end <= index) {
      protectedSpan = protectedSpans.next().value
    }

    node = advanceMatcher(matcher, node, value[index])
    let outputNode: SecretTrieNode | undefined = node.replacement ? node : node.outputLink
    while (outputNode?.replacement) {
      matchEvents += 1
      if (matchEvents > MAX_MATCH_EVENTS) {
        throw new ResolvedSecretMatcherError('Secret matcher event limit exceeded')
      }
      const end = index + 1
      const start = end - outputNode.replacement.plaintext.length
      if (
        !isMatchInsideProtectedReplacement(
          start,
          end,
          outputNode.replacement.plaintext,
          protectedSpan?.start ?? -1,
          protectedSpan?.end ?? -1,
          protectedSpan?.plaintexts
        )
      ) {
        return true
      }
      outputNode = outputNode.outputLink
    }
  }
  return false
}

/** Detects every literal match, including matches inside matcher-issued named placeholders. */
export function containsResolvedSecretLiteral(
  value: string,
  matcher: ResolvedSecretMatcher
): boolean {
  let node = matcher.root
  for (let index = 0; index < value.length; index += 1) {
    node = advanceMatcher(matcher, node, value[index])
    if (node.replacement || node.outputLink) return true
  }
  return false
}

/** Visits each distinct exact secret literal once with the content-projection automaton. */
export function scanResolvedSecretString(
  value: string,
  matcher: ResolvedSecretMatcher,
  onMatch: (plaintext: string) => void,
  maxMatchEvents = MAX_MATCH_EVENTS
): number {
  let node = matcher.root
  let matchEvents = 0
  const matchedPlaintexts = new Set<string>()
  const nextUnmatchedOutput = new WeakMap<SecretTrieNode, SecretTrieNode | null>()

  const findNextUnmatchedOutput = (
    candidate: SecretTrieNode | undefined
  ): SecretTrieNode | undefined => {
    let current = candidate
    const exhaustedPath: SecretTrieNode[] = []
    while (current?.replacement && matchedPlaintexts.has(current.replacement.plaintext)) {
      const cached = nextUnmatchedOutput.get(current)
      if (cached !== undefined) {
        current = cached ?? undefined
        continue
      }
      exhaustedPath.push(current)
      current = current.outputLink
    }
    for (const exhausted of exhaustedPath) {
      nextUnmatchedOutput.set(exhausted, current ?? null)
    }
    return current
  }

  for (let index = 0; index < value.length; index += 1) {
    node = advanceMatcher(matcher, node, value[index])
    let outputNode = findNextUnmatchedOutput(node.replacement ? node : node.outputLink)
    while (outputNode?.replacement) {
      matchEvents += 1
      if (matchEvents > maxMatchEvents) {
        throw new ResolvedSecretMatcherError('Secret matcher event limit exceeded')
      }
      matchedPlaintexts.add(outputNode.replacement.plaintext)
      onMatch(outputNode.replacement.plaintext)
      outputNode = findNextUnmatchedOutput(outputNode)
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
  /**
   * A substitution can leave a literal the previous pass could not act on: an empty replacement can
   * splice its neighbours into a literal that was not present in the input.
   * Each pass strictly consumes matches, so this converges in practice; the bound is what keeps a
   * pathological chain from looping, and the throw past it stays the fail-closed backstop callers
   * already handle by dropping the value.
   */
  let sanitized = substituteResolvedSecrets(value, matcher, maxBytes, onMatch)
  for (let pass = 1; containsResolvedSecret(sanitized, matcher); pass += 1) {
    if (pass >= MAX_SETTLE_PASSES) {
      throw new ResolvedSecretMatcherError('Sanitized content still contains an active secret')
    }
    sanitized = substituteResolvedSecrets(sanitized, matcher, maxBytes, onMatch)
  }
  return sanitized
}

function substituteResolvedSecrets(
  value: string,
  matcher: ResolvedSecretMatcher,
  maxBytes: number,
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
  const protectedSpans = iterateProtectedReplacementSpans(value, matcher)
  let protectedSpan = protectedSpans.next().value
  for (let index = 0; index < value.length; index += 1) {
    while (protectedSpan && protectedSpan.end <= index) {
      protectedSpan = protectedSpans.next().value
    }

    node = advanceMatcher(matcher, node, value[index])
    let outputNode: SecretTrieNode | undefined = node.replacement ? node : node.outputLink
    while (outputNode?.replacement) {
      onMatch?.(outputNode.replacement.plaintext)
      matchEvents += 1
      if (matchEvents > MAX_MATCH_EVENTS) {
        throw new ResolvedSecretMatcherError('Secret matcher event limit exceeded')
      }
      const start = index - outputNode.replacement.plaintext.length + 1
      const end = index + 1
      if (
        !isMatchInsideProtectedReplacement(
          start,
          end,
          outputNode.replacement.plaintext,
          protectedSpan?.start ?? -1,
          protectedSpan?.end ?? -1,
          protectedSpan?.plaintexts
        ) &&
        start >= emitCursor
      ) {
        const slot = start % windowSize
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
  matches: readonly ResolvedSecretMatch[],
  options: CreateResolvedSecretMatcherOptions = {}
): ResolvedSecretMatcher | undefined {
  const replacementByPlaintext = new Map<string, string>()

  for (const match of matches) {
    /**
     * Dropped before any construction-time check runs, so no later stage can be talked into
     * treating one of these as protectable.
     */
    if (!match.plaintext || isNonIdentifyingSecretLiteral(match.plaintext)) continue
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
  const candidateProtectedReplacementPlaintexts = new Map<string, Set<string>>()
  if (options.preserveNamedProvenanceLabels) {
    for (const { plaintext, replacement } of provisional) {
      if (!isNamedResolvedSecretReplacement(replacement) || !replacement.includes(plaintext)) {
        continue
      }
      const plaintexts =
        candidateProtectedReplacementPlaintexts.get(replacement) ?? new Set<string>()
      plaintexts.add(plaintext)
      candidateProtectedReplacementPlaintexts.set(replacement, plaintexts)
    }
  }
  detector.protectedReplacementPlaintexts = candidateProtectedReplacementPlaintexts
  detector.protectedReplacementMatcher = createProtectedReplacementMatcher(
    candidateProtectedReplacementPlaintexts
  )

  const exactReplacements = new Map<string, string>()
  const protectedReplacementPlaintexts = new Map<string, ReadonlySet<string>>()
  for (const { plaintext, replacement } of provisional) {
    const node = findTerminalNode(detector.root, plaintext)
    const namedReplacement = isNamedResolvedSecretReplacement(replacement)
    const replacementContainsSecret = containsResolvedSecret(replacement, detector)
    const safeReplacement = !replacementContainsSecret
      ? replacement
      : containsResolvedSecret(OPAQUE_RESOLVED_SECRET_REPLACEMENT, detector)
        ? ''
        : OPAQUE_RESOLVED_SECRET_REPLACEMENT
    if (namedReplacement && safeReplacement === replacement) {
      const plaintexts = candidateProtectedReplacementPlaintexts.get(replacement)
      if (plaintexts) protectedReplacementPlaintexts.set(replacement, plaintexts)
    }
    node.replacement = {
      plaintext,
      replacement: safeReplacement,
    }
    exactReplacements.set(plaintext, safeReplacement)
  }

  detector.exactReplacements = exactReplacements
  detector.protectedReplacementPlaintexts = protectedReplacementPlaintexts
  detector.protectedReplacementMatcher = createProtectedReplacementMatcher(
    protectedReplacementPlaintexts
  )
  return detector
}
