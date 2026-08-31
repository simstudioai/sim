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
 * Estimate the pretty-printed (`JSON.stringify(value, null, 2)`) size a single
 * value node contributes, including the indentation/newline overhead that
 * dominates deeply nested alias bombs and the exact escape expansion of strings.
 */
function estimateNodeBytes(value: unknown, depth: number): number {
  const indentOverhead = depth * 2 + 4
  if (typeof value === 'string') return indentOverhead + serializedStringLength(value)
  return indentOverhead + 16
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

/**
 * Iteratively walk the parsed value, charging every reached node against
 * `budget`, and return the document depth.
 *
 * Each node is charged as it is *enqueued*, before its own children are pushed,
 * and only container nodes go on the traversal stack. A pathologically wide
 * fan-out (an array of millions of aliases) therefore trips a limit during the
 * enqueue loop instead of first materializing millions of stack entries and
 * exhausting memory inside the guard itself.
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

  const rootOverflow = charge(estimateNodeBytes(root, 0))
  if (rootOverflow) return { within: false, reason: rootOverflow }

  const stack: Array<{ value: object; depth: number }> = []
  if (isContainer(root)) stack.push({ value: root, depth: 0 })

  while (stack.length > 0) {
    const { value, depth } = stack.pop()!
    const childDepth = depth + 1

    if (childDepth > maxDepth) maxDepth = childDepth
    if (childDepth > limits.maxDepth) {
      return {
        within: false,
        reason: `YAML document exceeds the maximum nesting depth of ${limits.maxDepth}`,
      }
    }

    if (Array.isArray(value)) {
      for (const child of value) {
        const overflow = charge(estimateNodeBytes(child, childDepth))
        if (overflow) return { within: false, reason: overflow }
        if (isContainer(child)) stack.push({ value: child, depth: childDepth })
      }
    } else {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const overflow = charge(estimateKeyBytes(key) + estimateNodeBytes(child, childDepth))
        if (overflow) return { within: false, reason: overflow }
        if (isContainer(child)) stack.push({ value: child, depth: childDepth })
      }
    }
  }

  return { within: true, depth: maxDepth }
}
