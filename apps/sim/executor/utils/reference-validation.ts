import { isLikelyReferenceSegment } from '@/lib/workflows/references'
import { REFERENCE } from '@/executor/consts'

/**
 * Creates a regex pattern for matching variable references.
 * Uses [^<>]+ to prevent matching across nested brackets (e.g., "<3 <real.ref>" matches separately).
 */
export function createReferencePattern(): RegExp {
  return new RegExp(
    `${REFERENCE.START}([^${REFERENCE.START}${REFERENCE.END}]+)${REFERENCE.END}`,
    'g'
  )
}

/**
 * Creates a regex pattern for matching environment variables {{variable}}
 */
export function createEnvVarPattern(): RegExp {
  return new RegExp(`\\${REFERENCE.ENV_VAR_START}([^}]+)\\${REFERENCE.ENV_VAR_END}`, 'g')
}

/**
 * Combined pattern matching both <reference> and {{env_var}}
 */
export function createCombinedPattern(): RegExp {
  return new RegExp(
    `${REFERENCE.START}[^${REFERENCE.START}${REFERENCE.END}]+${REFERENCE.END}|` +
      `\\${REFERENCE.ENV_VAR_START}[^}]+\\${REFERENCE.ENV_VAR_END}`,
    'g'
  )
}

/**
 * Replaces variable references with smart validation.
 * Distinguishes < operator from < bracket using isLikelyReferenceSegment.
 */
export function replaceValidReferences(
  template: string,
  replacer: (match: string) => string
): string {
  const pattern = createReferencePattern()

  return template.replace(pattern, (match) => {
    if (!isLikelyReferenceSegment(match)) {
      return match
    }
    return replacer(match)
  })
}
