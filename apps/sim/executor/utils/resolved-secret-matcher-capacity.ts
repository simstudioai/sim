const MAX_MATCHER_NODES = 250_000
const MAX_SECRET_LITERAL_LENGTH = 64 * 1024

export type ResolvedSecretMatcherCapacityFailure = 'literal-too-long' | 'node-limit-exceeded'

function compareStrings(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) index += 1
  return index
}

/** Returns why the exact UTF-16 trie used by the secret matcher would exceed its bounds. */
export function getResolvedSecretMatcherCapacityFailure(
  patterns: Iterable<string>
): ResolvedSecretMatcherCapacityFailure | undefined {
  const uniquePatterns = [...new Set(patterns)].filter((pattern) => pattern.length > 0)
  if (uniquePatterns.some((pattern) => pattern.length > MAX_SECRET_LITERAL_LENGTH)) {
    return 'literal-too-long'
  }

  uniquePatterns.sort(compareStrings)
  let nodeCount = 1
  let previous = ''
  for (const pattern of uniquePatterns) {
    nodeCount += pattern.length - commonPrefixLength(previous, pattern)
    if (nodeCount > MAX_MATCHER_NODES) return 'node-limit-exceeded'
    previous = pattern
  }
  return undefined
}
