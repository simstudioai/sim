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
 * Estimate the pretty-printed (`JSON.stringify(value, null, 2)`) byte cost a
 * single node contributes, including the indentation/newline overhead that
 * dominates deeply nested alias bombs.
 */
function estimateNodeBytes(value: unknown, depth: number): number {
  const indentOverhead = depth * 2 + 4
  if (typeof value === 'string') return indentOverhead + value.length + 2
  return indentOverhead + 16
}

/**
 * Iteratively walk the parsed YAML value with strict node-count, output-size,
 * and depth limits, returning the document depth. Repeated (aliased) references
 * are intentionally counted each time they are reached, mirroring the way
 * `JSON.stringify` expands them — this is what makes the alias-expansion bomb
 * detectable before serialization.
 *
 * @throws {YamlComplexityError} when any limit is exceeded
 */
export function assertYamlWithinLimits(root: unknown): number {
  let visited = 0
  let estimatedBytes = 0
  let maxDepth = 0

  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }]

  while (stack.length > 0) {
    const { value, depth } = stack.pop()!

    if (++visited > MAX_YAML_EXPANDED_NODES) {
      throw new YamlComplexityError(
        `YAML document exceeds the maximum of ${MAX_YAML_EXPANDED_NODES} expanded nodes (possible alias-expansion bomb)`
      )
    }

    estimatedBytes += estimateNodeBytes(value, depth)
    if (estimatedBytes > MAX_YAML_SERIALIZED_BYTES) {
      throw new YamlComplexityError(
        `YAML document expands beyond the maximum serialized size of ${MAX_YAML_SERIALIZED_BYTES} bytes (possible alias-expansion bomb)`
      )
    }

    if (value === null || typeof value !== 'object') continue

    if (depth + 1 > maxDepth) maxDepth = depth + 1
    if (depth + 1 > MAX_YAML_DEPTH) {
      throw new YamlComplexityError(
        `YAML document exceeds the maximum nesting depth of ${MAX_YAML_DEPTH}`
      )
    }

    const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)
    for (const child of children) {
      stack.push({ value: child, depth: depth + 1 })
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
