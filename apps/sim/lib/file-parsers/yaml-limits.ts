/**
 * Bounded traversal of a parsed YAML value, shared by every consumer that walks
 * one as a tree.
 *
 * `yaml.load` resolves aliases into shared references, so the parsed value is a
 * compact DAG that costs whatever the source cost. The amplification happens
 * afterwards, in whatever expands that DAG back into a tree — `JSON.stringify`
 * in the file parser, the fence renderers in the page compiler. A sub-kilobyte
 * source can carry millions of expanded nodes, so the expansion has to be
 * measured and rejected before anything materializes it.
 *
 * Repeated (aliased) references are intentionally charged on every reach, which
 * is what makes the amplification visible here rather than at materialization
 * time. Charging on reach also terminates on self-referential anchors.
 */

/** Ceilings for one traversal. Callers pick values matched to what they render. */
export interface YamlExpansionLimits {
  /** Expanded nodes — every value reached, aliases counted once per path. */
  maxNodes: number
  /** Estimated pretty-printed JSON size of the expanded tree. */
  maxSerializedBytes: number
  /** Nesting depth, which also bounds the traversal's own working set. */
  maxDepth: number
}

/**
 * Allowance remaining across every traversal that shares one unit of work — a
 * page compile parses its frontmatter and each `sim:` fence separately, and it
 * is their SUM that a request pays for, so they draw down one budget rather than
 * each getting the full limits.
 */
export interface YamlExpansionBudget {
  nodes: number
  bytes: number
}

export function createYamlExpansionBudget(limits: YamlExpansionLimits): YamlExpansionBudget {
  return { nodes: limits.maxNodes, bytes: limits.maxSerializedBytes }
}

/** True once a budget has nothing left, so callers can skip parsing entirely. */
export function isYamlExpansionBudgetExhausted(budget: YamlExpansionBudget): boolean {
  return budget.nodes <= 0 || budget.bytes <= 0
}

export type YamlExpansionResult =
  | { within: true; depth: number }
  | { within: false; reason: string }

/**
 * Exact serialized length (in UTF-16 code units — the unit V8 allocates for the
 * resulting string) that `JSON.stringify` produces for a string, accounting for
 * the escape expansion of quotes, backslashes, control characters, and lone
 * surrogates. Computed precisely rather than with a flat multiplier so plain
 * text is charged its true size (no false rejection of large legitimate
 * documents) while escape-heavy strings are charged their real, larger cost
 * (no cap bypass).
 */
function serializedStringLength(value: string): number {
  let length = 2 // surrounding quotes
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code === 0x22 /* " */ || code === 0x5c /* \ */) {
      length += 2
    } else if (code < 0x20) {
      // \b \t \n \f \r use two-char escapes; other control chars use \uXXXX (six)
      length +=
        code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6
    } else if (code >= 0xd800 && code <= 0xdfff) {
      // Well-formed JSON.stringify emits a valid high+low surrogate pair as-is
      // (two code units) but escapes a lone surrogate to \uXXXX (six).
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0
      if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        length += 2
        i++
      } else {
        length += 6
      }
    } else {
      length += 1
    }
  }
  return length
}

/**
 * Flat allowance for a value whose serialized form is bounded by its own kind:
 * `true`, `false`, `null`, and the punctuation a container contributes on its own
 * line all fit well inside it.
 */
const NON_STRING_NODE_BYTES = 16

/**
 * Estimate the pretty-printed (`JSON.stringify(value, null, 2)`) size a single
 * value node contributes, including the indentation/newline overhead that
 * dominates deeply nested alias bombs and the exact escape expansion of strings.
 */
function estimateNodeBytes(value: unknown, depth: number): number {
  const indentOverhead = depth * 2 + 4
  if (typeof value === 'string') return indentOverhead + serializedStringLength(value)
  // A double can serialize to 24 characters (`-1.2345678901234567e-308`), so a
  // number is the one non-string value that outgrows the flat allowance — charging
  // it the allowance would let a document of them exceed the byte cap by half again.
  // Taking the larger of the two never charges less than before.
  if (typeof value === 'number') {
    return indentOverhead + Math.max(NON_STRING_NODE_BYTES, String(value).length)
  }
  return indentOverhead + NON_STRING_NODE_BYTES
}

/**
 * Estimate the serialized size of an object key (`"key": `). Keys are re-emitted
 * on every alias expansion of their parent object, so an aliased object with a
 * long key amplifies just like an aliased value — this must be charged or the
 * size cap is trivially bypassed.
 */
function estimateKeyBytes(key: string): number {
  return serializedStringLength(key) + 2 // ": "
}

function isContainer(value: unknown): value is object {
  return value !== null && typeof value === 'object'
}

/** One child of a container, with the serialized cost of naming it. */
interface YamlChild {
  keyBytes: number
  value: unknown
}

/**
 * Yields a container's children one at a time.
 *
 * Lazily, and via `for...in` rather than `Object.entries`, because this runs on
 * untrusted input: eagerly building the child list would let a single wide node
 * allocate an array proportional to its fan-out *before* the first byte of it is
 * charged, which is the allocation the guard exists to prevent.
 */
function* childrenOf(container: object): Generator<YamlChild> {
  if (Array.isArray(container)) {
    for (const value of container) yield { keyBytes: 0, value }
    return
  }
  for (const key in container) {
    if (Object.hasOwn(container, key)) {
      yield { keyBytes: estimateKeyBytes(key), value: (container as Record<string, unknown>)[key] }
    }
  }
}

/**
 * Iteratively walk the parsed value, charging every reached node against
 * `budget`, and return the document depth.
 *
 * Each node is charged as it is reached, before any of its own children are, so a
 * pathologically wide fan-out (an array of millions of aliases) trips a limit part
 * way through that node rather than after enumerating it. The traversal holds one
 * frame per level of nesting rather than one per pending node, so its own working
 * set is bounded by `maxDepth` and not by the document's width — a guard that
 * allocated in proportion to the fan-out it is meant to reject would be its own
 * exhaustion path.
 *
 * A size or node rejection leaves the budget spent, because reaching it means the
 * allowance ran out mid-walk — a shared budget therefore short-circuits every
 * later document instead of paying for a full walk each time. A depth rejection
 * costs only its own nesting, so it does not draw the budget down further and
 * later documents sharing it still get measured.
 */
export function measureYamlExpansion(
  root: unknown,
  limits: YamlExpansionLimits,
  budget: YamlExpansionBudget = createYamlExpansionBudget(limits)
): YamlExpansionResult {
  let maxDepth = 0

  /** Draws the node down the budget and returns a rejection reason, or null when it fits. */
  const charge = (bytes: number): string | null => {
    if (--budget.nodes < 0) {
      return `YAML document exceeds the maximum of ${limits.maxNodes} expanded nodes (possible alias-expansion bomb)`
    }
    budget.bytes -= bytes
    if (budget.bytes < 0) {
      return `YAML document expands beyond the maximum serialized size of ${limits.maxSerializedBytes} bytes (possible alias-expansion bomb)`
    }
    return null
  }

  const tooDeep: YamlExpansionResult = {
    within: false,
    reason: `YAML document exceeds the maximum nesting depth of ${limits.maxDepth}`,
  }

  const rootOverflow = charge(estimateNodeBytes(root, 0))
  if (rootOverflow) return { within: false, reason: rootOverflow }

  /** One frame per level of nesting; `depth` is the depth of the children it yields. */
  const stack: Array<{ children: Generator<YamlChild>; depth: number }> = []

  const descend = (container: object, depth: number): boolean => {
    if (depth > maxDepth) maxDepth = depth
    if (depth > limits.maxDepth) return false
    stack.push({ children: childrenOf(container), depth })
    return true
  }

  if (isContainer(root) && !descend(root, 1)) return tooDeep

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]
    const next = frame.children.next()
    if (next.done) {
      stack.pop()
      continue
    }

    const { keyBytes, value } = next.value
    const overflow = charge(keyBytes + estimateNodeBytes(value, frame.depth))
    if (overflow) return { within: false, reason: overflow }
    if (isContainer(value) && !descend(value, frame.depth + 1)) return tooDeep
  }

  return { within: true, depth: maxDepth }
}
