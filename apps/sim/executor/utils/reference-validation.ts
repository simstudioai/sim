import { isLikelyReferenceSegment } from '@/lib/workflows/sanitization/references'
import { REFERENCE } from '@/executor/constants'

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

export interface EnvVarResolveOptions {
  allowEmbedded?: boolean
  resolveExactMatch?: boolean
  trimKeys?: boolean
  onMissing?: 'keep' | 'throw' | 'empty'
  deep?: boolean
  missingKeys?: string[]
}

/**
 * Resolve {{ENV_VAR}} references in values using provided env vars.
 */
export function resolveEnvVarReferences(
  value: unknown,
  envVars: Record<string, string>,
  options: EnvVarResolveOptions = {}
): unknown {
  const {
    allowEmbedded = true,
    resolveExactMatch = true,
    trimKeys = false,
    onMissing = 'keep',
    deep = true,
  } = options

  if (typeof value === 'string') {
    if (resolveExactMatch) {
      const exactMatchPattern = new RegExp(
        `^\\${REFERENCE.ENV_VAR_START}([^}]+)\\${REFERENCE.ENV_VAR_END}$`
      )
      const exactMatch = exactMatchPattern.exec(value)
      if (exactMatch) {
        const envKey = trimKeys ? exactMatch[1].trim() : exactMatch[1]
        const envValue = envVars[envKey]
        if (envValue !== undefined) return envValue
        if (options.missingKeys) options.missingKeys.push(envKey)
        if (onMissing === 'throw') {
          throw new Error(`Environment variable "${envKey}" was not found`)
        }
        if (onMissing === 'empty') {
          return ''
        }
        return value
      }
    }

    if (!allowEmbedded) return value

    const envVarPattern = createEnvVarPattern()
    return value.replace(envVarPattern, (match, varName) => {
      const envKey = trimKeys ? String(varName).trim() : String(varName)
      const envValue = envVars[envKey]
      if (envValue !== undefined) return envValue
      if (options.missingKeys) options.missingKeys.push(envKey)
      if (onMissing === 'throw') {
        throw new Error(`Environment variable "${envKey}" was not found`)
      }
      if (onMissing === 'empty') {
        return ''
      }
      return match
    })
  }

  if (deep && Array.isArray(value)) {
    return value.map((item) => resolveEnvVarReferences(item, envVars, options))
  }

  if (deep && value !== null && typeof value === 'object') {
    const resolved: Record<string, any> = {}
    for (const [key, val] of Object.entries(value)) {
      resolved[key] = resolveEnvVarReferences(val, envVars, options)
    }
    return resolved
  }

  return value
}

/**
 * Creates a regex pattern for matching workflow variables <variable.name>
 * Captures the variable name (after "variable.") in group 1
 */
export function createWorkflowVariablePattern(): RegExp {
  return new RegExp(
    `${REFERENCE.START}${REFERENCE.PREFIX.VARIABLE}\\${REFERENCE.PATH_DELIMITER}([^${REFERENCE.START}${REFERENCE.END}]+)${REFERENCE.END}`,
    'g'
  )
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
