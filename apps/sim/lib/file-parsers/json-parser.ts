import { getErrorMessage } from '@sim/utils/errors'
import { FileParserError } from '@/lib/file-parsers/errors'
import type { FileParseResult } from '@/lib/file-parsers/types'

const MAX_JSON_DEPTH = 500
const MAX_JSON_NODES = 1_000_000
const MAX_JSON_SERIALIZED_UNITS = 64 * 1024 * 1024

interface JsonComplexityBudget {
  nodes: number
  serializedUnits: number
}

interface JsonTraversalFrame {
  value: unknown[] | Record<string, unknown>
  depth: number
  index: number
  keys?: string[]
}

/**
 * Returns the exact number of UTF-16 code units JSON serialization needs for a
 * string, including quotes and escape expansion, without allocating the result.
 */
function serializedJsonStringLength(value: string): number {
  let length = 2
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code === 0x22 || code === 0x5c) {
      length += 2
    } else if (code < 0x20) {
      length +=
        code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6
    } else if (code >= 0xd800 && code <= 0xdfff) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : 0
      if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        length += 2
        index++
      } else {
        length += 6
      }
    } else {
      length++
    }
  }
  return length
}

function estimateJsonValueUnits(value: unknown, depth: number): number {
  const formattingOverhead = depth * 2 + 4
  if (typeof value === 'string') {
    return formattingOverhead + serializedJsonStringLength(value)
  }
  if (typeof value === 'number') return formattingOverhead + String(value).length
  if (typeof value === 'boolean') return formattingOverhead + (value ? 4 : 5)
  if (value === null) return formattingOverhead + 4
  return formattingOverhead + 2
}

function chargeJsonComplexity(
  budget: JsonComplexityBudget,
  value: unknown,
  depth: number,
  key?: string
): void {
  budget.nodes++
  if (budget.nodes > MAX_JSON_NODES) {
    throw new FileParserError(
      'complexity_limit',
      `JSON document exceeds the maximum of ${MAX_JSON_NODES.toLocaleString()} values`
    )
  }

  budget.serializedUnits +=
    estimateJsonValueUnits(value, depth) +
    (key === undefined ? 0 : serializedJsonStringLength(key) + 2)
  if (budget.serializedUnits > MAX_JSON_SERIALIZED_UNITS) {
    throw new FileParserError(
      'complexity_limit',
      `JSON document expands beyond the maximum serialized size of ${MAX_JSON_SERIALIZED_UNITS} characters`
    )
  }
}

/**
 * Iteratively validates a parsed JSON value before pretty-printing it. The
 * traversal keeps only one frame per nesting level and avoids recursively
 * materializing child-value arrays while trying to reject the document.
 */
function assertJsonValueWithinLimits(
  root: unknown,
  budget: JsonComplexityBudget,
  initialDepth = 0
): number {
  let maxDepth = initialDepth
  const stack: JsonTraversalFrame[] = []

  const enterValue = (value: unknown, depth: number, key?: string): void => {
    chargeJsonComplexity(budget, value, depth, key)
    if (value === null || typeof value !== 'object') return
    if (depth >= MAX_JSON_DEPTH) {
      throw new FileParserError(
        'complexity_limit',
        `JSON document exceeds the maximum nesting depth of ${MAX_JSON_DEPTH}`
      )
    }

    maxDepth = Math.max(maxDepth, depth + 1)
    if (Array.isArray(value)) {
      stack.push({ value, depth, index: 0 })
    } else {
      const record = value as Record<string, unknown>
      stack.push({ value: record, depth, index: 0, keys: Object.keys(record) })
    }
  }

  enterValue(root, initialDepth)
  while (stack.length > 0) {
    const frame = stack.at(-1)!
    if (Array.isArray(frame.value)) {
      if (frame.index >= frame.value.length) {
        stack.pop()
        continue
      }
      const child = frame.value[frame.index]
      frame.index++
      enterValue(child, frame.depth + 1)
      continue
    }

    const keys = frame.keys!
    if (frame.index >= keys.length) {
      stack.pop()
      continue
    }
    const key = keys[frame.index]
    frame.index++
    enterValue(frame.value[key], frame.depth + 1, key)
  }

  return maxDepth
}

function buildJsonResult(jsonData: unknown): FileParseResult {
  const budget = { nodes: 0, serializedUnits: 0 }
  const depth = assertJsonValueWithinLimits(jsonData, budget)
  const formattedContent = JSON.stringify(jsonData, null, 2)
  const isArray = Array.isArray(jsonData)
  const isRecord = jsonData !== null && typeof jsonData === 'object' && !isArray

  return {
    content: formattedContent,
    metadata: {
      type: 'json',
      isArray,
      keys: isRecord ? Object.keys(jsonData as Record<string, unknown>) : [],
      itemCount: isArray ? jsonData.length : undefined,
      depth,
    },
  }
}

function parseJsonContent(content: string): FileParseResult {
  try {
    return buildJsonResult(JSON.parse(content))
  } catch (error) {
    if (error instanceof FileParserError) throw error
    if (!(error instanceof SyntaxError)) {
      throw new FileParserError('runtime_failure', 'JSON processing failed unexpectedly', error)
    }
    throw new FileParserError(
      'invalid_format',
      `Invalid JSON: ${getErrorMessage(error, 'Unknown error')}`,
      error
    )
  }
}

/** Parse a JSON file. */
export async function parseJSON(filePath: string): Promise<FileParseResult> {
  const fs = await import('fs/promises')
  return parseJsonContent(await fs.readFile(filePath, 'utf-8'))
}

/** Parse JSON from a buffer. */
export async function parseJSONBuffer(buffer: Buffer): Promise<FileParseResult> {
  return parseJsonContent(buffer.toString('utf-8'))
}

function* iterateJsonLines(content: string): Generator<{ line: string; lineNumber: number }> {
  let lineStart = 0
  let lineNumber = 1
  while (lineStart <= content.length) {
    const newline = content.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? content.length : newline
    const line = content.slice(lineStart, lineEnd)
    if (line.trim()) yield { line, lineNumber }
    if (newline === -1) break
    lineStart = newline + 1
    lineNumber++
  }
}

function parseJsonLinesContent(content: string): FileParseResult {
  const items: unknown[] = []
  const budget = { nodes: 0, serializedUnits: 0 }
  let depth = assertJsonValueWithinLimits([], budget)

  for (const { line, lineNumber } of iterateJsonLines(content)) {
    let item: unknown
    try {
      item = JSON.parse(line)
    } catch (error) {
      throw new FileParserError(
        'invalid_format',
        `Invalid JSONL on line ${lineNumber}: ${line.slice(0, 100)}`,
        error
      )
    }
    depth = Math.max(depth, assertJsonValueWithinLimits(item, budget, 1))
    items.push(item)
  }

  return {
    content: JSON.stringify(items, null, 2),
    metadata: {
      type: 'json',
      isArray: true,
      keys: [],
      itemCount: items.length,
      depth,
    },
  }
}

/** Parse a JSON Lines file. */
export async function parseJSONL(filePath: string): Promise<FileParseResult> {
  const fs = await import('fs/promises')
  return parseJsonLinesContent(await fs.readFile(filePath, 'utf-8'))
}

/** Parse JSON Lines from a buffer. */
export async function parseJSONLBuffer(buffer: Buffer): Promise<FileParseResult> {
  return parseJsonLinesContent(buffer.toString('utf-8'))
}
