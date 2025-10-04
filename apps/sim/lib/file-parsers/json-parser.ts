import type { FileParseResult } from './types'

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
