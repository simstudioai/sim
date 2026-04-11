import type { FileParseResult } from '@/lib/file-parsers/types'

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
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
    } catch {
      throw new Error(`Invalid JSONL: failed to parse line: ${line.slice(0, 100)}`)
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
function getJsonDepth(obj: any): number {
  if (obj === null || typeof obj !== 'object') return 0

  if (Array.isArray(obj)) {
    return obj.length > 0 ? 1 + Math.max(...obj.map(getJsonDepth)) : 1
  }

  const depths = Object.values(obj).map(getJsonDepth)
  return depths.length > 0 ? 1 + Math.max(...depths) : 1
}
