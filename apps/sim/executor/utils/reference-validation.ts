import { isLikelyReferenceSegment } from '@/lib/workflows/references'
import { REFERENCE } from '@/executor/consts'

/**
 * Creates a regex pattern for matching variable references in the format <reference>
 * This pattern matches content between < and > brackets without allowing nested brackets.
 * Uses [^<>]+ to prevent matching across multiple reference attempts.
 */
export function createReferencePattern(): RegExp {
  // Match < followed by content that doesn't contain < or >, followed by >
  // This prevents matching "<3. text <real.reference>" as one big match
  return new RegExp(
    `${REFERENCE.START}([^${REFERENCE.START}${REFERENCE.END}]+)${REFERENCE.END}`,
    'g'
  )
}

/**
 * Creates a regex pattern for matching environment variable references in the format {{variable}}
 */
export function createEnvVarPattern(): RegExp {
  return new RegExp(`\\${REFERENCE.ENV_VAR_START}([^}]+)\\${REFERENCE.ENV_VAR_END}`, 'g')
}

/**
 * Creates a combined regex pattern for matching both variable references and environment variables
 * Returns a pattern that matches: <reference> or {{env_var}}
 */
export function createCombinedPattern(): RegExp {
  return new RegExp(
    `${REFERENCE.START}[^${REFERENCE.START}${REFERENCE.END}]+${REFERENCE.END}|` +
      `\\${REFERENCE.ENV_VAR_START}[^}]+\\${REFERENCE.ENV_VAR_END}`,
    'g'
  )
}

/**
 * Validates if a matched string is a likely variable reference using smart detection.
 * This prevents treating operators like "<5" or "< 10" as variable references.
 *
 * Rules:
 * - Must contain a valid block/variable name before the first dot (if dot exists)
 * - Cannot start with spaces
 * - Cannot contain invalid characters like +, *, /, =, <, >, ! in the wrong positions
 * - Must follow variable reference syntax: <blockName.field> or <variable.name>
 *
 * @param match - The matched string (e.g., "<blockName.field>")
 * @returns true if this is likely a variable reference, false otherwise
 */
export function isValidVariableReference(match: string): boolean {
  return isLikelyReferenceSegment(match)
}

/**
 * Replaces variable references in a template string with a callback function.
 * Only processes matches that pass smart validation to avoid treating operators
 * like "<" as variable reference opening brackets.
 *
 * @param template - The template string containing potential variable references
 * @param replacer - Callback function that receives the match and returns the replacement
 * @returns The template with valid variable references replaced
 *
 * @example
 * ```ts
 * const result = replaceValidReferences(
 *   "Value is <block.value> and condition <loop.index> < 10",
 *   (match) => resolveReference(match)
 * )
 * // Only <block.value> and <loop.index> are replaced, "< 10" is left as-is
 * ```
 */
export function replaceValidReferences(
  template: string,
  replacer: (match: string) => string
): string {
  const pattern = createReferencePattern()

  return template.replace(pattern, (match) => {
    // Smart validation: only process if this looks like a valid variable reference
    // This prevents treating things like "<5" or "< 10" as variable references
    if (!isValidVariableReference(match)) {
      return match
    }

    return replacer(match)
  })
}
