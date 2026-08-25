import { getErrorMessage } from '@sim/utils/errors'
import { FileParserError } from '@/lib/file-parsers/errors'
import type { FileParseResult } from '@/lib/file-parsers/types'

const MAX_JSON_DEPTH = 500

/**
 * Parse JSON files
 */
export async function parseJSON(filePath: string): Promise<FileParseResult> {
  const fs = await import('fs/promises')
  const content = await fs.readFile(filePath, 'utf-8')

  try {
    // Parse to validate JSON
    const jsonData = JSON.parse(content)

    // Return pretty-printed JSON for better readability
    const formattedContent = JSON.stringify(jsonData, null, 2)

    // Extract metadata about the JSON structure
    const metadata = {
      type: 'json',
      isArray: Array.isArray(jsonData),
      keys: Array.isArray(jsonData) ? [] : Object.keys(jsonData),
      itemCount: Array.isArray(jsonData) ? jsonData.length : undefined,
      depth: getJsonDepth(jsonData),
    }

    return {
      content: formattedContent,
      metadata,
    }
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

/**
 * Parse JSON from buffer
 */
export async function parseJSONBuffer(buffer: Buffer): Promise<FileParseResult> {
  const content = buffer.toString('utf-8')

  try {
    const jsonData = JSON.parse(content)
    const formattedContent = JSON.stringify(jsonData, null, 2)

    const metadata = {
      type: 'json',
      isArray: Array.isArray(jsonData),
      keys: Array.isArray(jsonData) ? [] : Object.keys(jsonData),
      itemCount: Array.isArray(jsonData) ? jsonData.length : undefined,
      depth: getJsonDepth(jsonData),
    }

    return {
      content: formattedContent,
      metadata,
    }
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

/**
 * Parse JSONL (JSON Lines) files — one JSON object per line
 */
export async function parseJSONL(filePath: string): Promise<FileParseResult> {
  const fs = await import('fs/promises')
  const content = await fs.readFile(filePath, 'utf-8')
  return parseJSONLContent(content)
}

/**
 * Parse JSONL from buffer
 */
export async function parseJSONLBuffer(buffer: Buffer): Promise<FileParseResult> {
  const content = buffer.toString('utf-8')
  return parseJSONLContent(content)
}

function parseJSONLContent(content: string): FileParseResult {
  const lines = content.split('\n').filter((line) => line.trim())
  const items: unknown[] = []

  for (const line of lines) {
    try {
      items.push(JSON.parse(line))
    } catch (error) {
      throw new FileParserError(
        'invalid_format',
        `Invalid JSONL: failed to parse line: ${line.slice(0, 100)}`,
        error
      )
    }
  }

  const formattedContent = JSON.stringify(items, null, 2)

  return {
    content: formattedContent,
    metadata: {
      type: 'json',
      isArray: true,
      keys: [],
      itemCount: items.length,
      depth: items.length > 0 ? 1 + getJsonDepth(items[0]) : 1,
    },
  }
}

/**
 * Calculate the depth of a JSON object
 */
function getJsonDepth(value: unknown, depth = 0): number {
  if (value === null || typeof value !== 'object') return depth
  if (depth >= MAX_JSON_DEPTH) {
    throw new FileParserError(
      'complexity_limit',
      `JSON document exceeds the maximum nesting depth of ${MAX_JSON_DEPTH}`
    )
  }

  let maxDepth = depth + 1
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)
  for (const child of children) {
    maxDepth = Math.max(maxDepth, getJsonDepth(child, depth + 1))
  }
  return maxDepth
}
