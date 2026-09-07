import { getErrorMessage } from '@sim/utils/errors'
import * as yaml from 'js-yaml'
import { FileParserError } from '@/lib/file-parsers/errors'
import type { FileParseResult } from '@/lib/file-parsers/types'
import { measureYamlExpansion, type YamlExpansionLimits } from '@/lib/file-parsers/yaml-limits'

/**
 * What a parsed YAML file may expand to once `JSON.stringify` walks its alias
 * DAG as a tree. The node cap also stops traversal of self-referential anchors;
 * the byte cap bounds output a sub-1 KB input can inflate to hundreds of MB;
 * the depth cap bounds the traversal's own working set.
 */
export const FILE_PARSER_YAML_LIMITS: YamlExpansionLimits = {
  maxNodes: 5_000_000,
  maxSerializedBytes: 64 * 1024 * 1024,
  maxDepth: 500,
}

/**
 * Raised when a parsed YAML document exceeds the complexity limits above.
 * Distinct from a syntax error so callers can tell a malformed file apart from
 * a resource-exhaustion (alias-expansion DoS) attempt.
 */
export class YamlComplexityError extends FileParserError {
  constructor(message: string) {
    super('complexity_limit', message)
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
 * Validate that a parsed YAML value stays within the file parser's expansion
 * limits, returning the document depth.
 *
 * @throws {YamlComplexityError} when any limit is exceeded
 */
export function assertYamlWithinLimits(root: unknown): number {
  const measured = measureYamlExpansion(root, FILE_PARSER_YAML_LIMITS)
  if (!measured.within) throw new YamlComplexityError(measured.reason)
  return measured.depth
}

/**
 * Parse a YAML value into the shared `FileParseResult` shape after validating
 * that its expanded form stays within safe complexity limits.
 */
function buildYamlResult(yamlData: unknown): FileParseResult {
  if (yamlData === undefined) {
    throw new FileParserError('empty_input', 'Empty YAML input provided')
  }

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
    if (error instanceof FileParserError) throw error
    throw new FileParserError(
      'invalid_format',
      `Invalid YAML: ${getErrorMessage(error, 'Unknown error')}`,
      error
    )
  }
}

/**
 * Parse YAML from buffer
 */
export async function parseYAMLBuffer(buffer: Buffer): Promise<FileParseResult> {
  if (!buffer || buffer.length === 0) {
    throw new FileParserError('empty_input', 'Empty buffer provided')
  }

  const content = buffer.toString('utf-8')

  try {
    const yamlData = yaml.load(content)
    return buildYamlResult(yamlData)
  } catch (error) {
    if (error instanceof FileParserError) throw error
    throw new FileParserError(
      'invalid_format',
      `Invalid YAML: ${getErrorMessage(error, 'Unknown error')}`,
      error
    )
  }
}
