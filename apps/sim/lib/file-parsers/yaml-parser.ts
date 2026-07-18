import { getErrorMessage } from '@sim/utils/errors'
import * as yaml from 'js-yaml'
import type { FileParseResult } from '@/lib/file-parsers/types'

/**
 * Hard cap on the number of expanded nodes visited while validating a parsed
 * YAML document. `yaml.load` resolves aliases into shared references, so the
 * in-memory value is a compact DAG, but `JSON.stringify` expands that DAG into
 * a full tree — duplicating every shared node. A tiny "billion laughs" alias
 * bomb therefore expands to millions/billions of nodes at serialize time. This
 * cap (and the byte cap below) bound the traversal so the amplification is
 * detected and rejected before it ever reaches `JSON.stringify`. It also stops
 * traversal of self-referential (cyclic) YAML anchors.
 */
const MAX_YAML_EXPANDED_NODES = 5_000_000

/**
 * Cap on the estimated serialized (pretty-printed JSON) size of the document.
 * Alias expansion inflates output far beyond the input size — a sub-1 KB input
 * can serialize to hundreds of MB — so we estimate output bytes during the
 * bounded traversal and abort past this limit rather than allocating them.
 */
const MAX_YAML_SERIALIZED_BYTES = 64 * 1024 * 1024

/**
 * Cap on nesting depth. Guards the depth computation (previously an unbounded
 * recursion that also spread large arrays into `Math.max(...array)`, risking a
 * stack overflow) and rejects pathologically deep documents.
 */
const MAX_YAML_DEPTH = 500

/**
 * Raised when a parsed YAML document exceeds the complexity limits above.
 * Distinct from a syntax error so callers can tell a malformed file apart from
 * a resource-exhaustion (alias-expansion DoS) attempt.
 */
export class YamlComplexityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'YamlComplexityError'
  }
}

/**
 * Type guard for {@link YamlComplexityError}. Callers use this to fail closed on
 * a complexity-limit rejection instead of falling back to a generic parse.
 */
export function isYamlComplexityError(error: unknown): error is YamlComplexityError {
  return error instanceof YamlComplexityError
}

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

/**
 * Iteratively walk the parsed YAML value with strict node-count, output-size,
 * and depth limits, returning the document depth. Repeated (aliased) references
 * are intentionally counted each time they are reached, mirroring the way
 * `JSON.stringify` expands them — this is what makes the alias-expansion bomb
 * detectable before serialization.
 *
 * Each node is charged against the caps as it is *enqueued*, before its own
 * children are pushed, and only container nodes are pushed onto the traversal
 * stack. A pathologically wide fan-out (e.g. an array of millions of aliases)
 * therefore trips a cap during the enqueue loop instead of first materializing
 * millions of stack entries and exhausting memory inside the guard itself.
 *
 * @throws {YamlComplexityError} when any limit is exceeded
 */
export function assertYamlWithinLimits(root: unknown): number {
  let visited = 0
  let estimatedBytes = 0
  let maxDepth = 0

  const charge = (bytes: number): void => {
    if (++visited > MAX_YAML_EXPANDED_NODES) {
      throw new YamlComplexityError(
        `YAML document exceeds the maximum of ${MAX_YAML_EXPANDED_NODES} expanded nodes (possible alias-expansion bomb)`
      )
    }
    estimatedBytes += bytes
    if (estimatedBytes > MAX_YAML_SERIALIZED_BYTES) {
      throw new YamlComplexityError(
        `YAML document expands beyond the maximum serialized size of ${MAX_YAML_SERIALIZED_BYTES} bytes (possible alias-expansion bomb)`
      )
    }
  }

  const isContainer = (value: unknown): value is object =>
    value !== null && typeof value === 'object'

  charge(estimateNodeBytes(root, 0))
  const stack: Array<{ value: object; depth: number }> = []
  if (isContainer(root)) stack.push({ value: root, depth: 0 })

  while (stack.length > 0) {
    const { value, depth } = stack.pop()!
    const childDepth = depth + 1

    if (childDepth > maxDepth) maxDepth = childDepth
    if (childDepth > MAX_YAML_DEPTH) {
      throw new YamlComplexityError(
        `YAML document exceeds the maximum nesting depth of ${MAX_YAML_DEPTH}`
      )
    }

    if (Array.isArray(value)) {
      for (const child of value) {
        charge(estimateNodeBytes(child, childDepth))
        if (isContainer(child)) stack.push({ value: child, depth: childDepth })
      }
    } else {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        charge(estimateKeyBytes(key) + estimateNodeBytes(child, childDepth))
        if (isContainer(child)) stack.push({ value: child, depth: childDepth })
      }
    }
  }

  return maxDepth
}

/**
 * Parse a YAML value into the shared `FileParseResult` shape after validating
 * that its expanded form stays within safe complexity limits.
 */
function buildYamlResult(yamlData: unknown): FileParseResult {
  const depth = assertYamlWithinLimits(yamlData)
  const jsonContent = JSON.stringify(yamlData, null, 2)

  const metadata = {
    type: 'yaml',
    isArray: Array.isArray(yamlData),
    keys: Array.isArray(yamlData) ? [] : Object.keys((yamlData as Record<string, unknown>) || {}),
    itemCount: Array.isArray(yamlData) ? yamlData.length : undefined,
    depth,
  }

  return {
    content: jsonContent,
    metadata,
  }
}

/**
 * Parse YAML files
 */
export async function parseYAML(filePath: string): Promise<FileParseResult> {
  const fs = await import('fs/promises')
  const content = await fs.readFile(filePath, 'utf-8')

  try {
    const yamlData = yaml.load(content)
    return buildYamlResult(yamlData)
  } catch (error) {
    if (error instanceof YamlComplexityError) throw error
    throw new Error(`Invalid YAML: ${getErrorMessage(error, 'Unknown error')}`)
  }
}

/**
 * Parse YAML from buffer
 */
export async function parseYAMLBuffer(buffer: Buffer): Promise<FileParseResult> {
  const content = buffer.toString('utf-8')

  try {
    const yamlData = yaml.load(content)
    return buildYamlResult(yamlData)
  } catch (error) {
    if (error instanceof YamlComplexityError) throw error
    throw new Error(`Invalid YAML: ${getErrorMessage(error, 'Unknown error')}`)
  }
}
