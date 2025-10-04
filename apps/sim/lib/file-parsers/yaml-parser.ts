import * as yaml from 'js-yaml'
import type { FileParseResult } from './types'

/**
 * Parse YAML files
 */
export async function parseYAML(filePath: string): Promise<FileParseResult> {
  const fs = await import('fs/promises')
  const content = await fs.readFile(filePath, 'utf-8')

  try {
    // Parse YAML to validate and extract structure
    const yamlData = yaml.load(content)

    // Convert to JSON for consistent processing
    const jsonContent = JSON.stringify(yamlData, null, 2)

    // Extract metadata about the YAML structure
    const metadata = {
      type: 'yaml',
      isArray: Array.isArray(yamlData),
      keys: Array.isArray(yamlData) ? [] : Object.keys(yamlData || {}),
      itemCount: Array.isArray(yamlData) ? yamlData.length : undefined,
      depth: getYamlDepth(yamlData),
    }

    return {
      content: jsonContent,
      metadata,
    }
  } catch (error) {
    throw new Error(`Invalid YAML: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Parse YAML from buffer
 */
export async function parseYAMLBuffer(buffer: Buffer): Promise<FileParseResult> {
  const content = buffer.toString('utf-8')

  try {
    const yamlData = yaml.load(content)
    const jsonContent = JSON.stringify(yamlData, null, 2)

    const metadata = {
      type: 'yaml',
      isArray: Array.isArray(yamlData),
      keys: Array.isArray(yamlData) ? [] : Object.keys(yamlData || {}),
      itemCount: Array.isArray(yamlData) ? yamlData.length : undefined,
      depth: getYamlDepth(yamlData),
    }

    return {
      content: jsonContent,
      metadata,
    }
  } catch (error) {
    throw new Error(`Invalid YAML: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Calculate the depth of a YAML/JSON object
 */
function getYamlDepth(obj: any): number {
  if (obj === null || typeof obj !== 'object') return 0

  if (Array.isArray(obj)) {
    return obj.length > 0 ? 1 + Math.max(...obj.map(getYamlDepth)) : 1
  }

  const depths = Object.values(obj).map(getYamlDepth)
  return depths.length > 0 ? 1 + Math.max(...depths) : 1
}
