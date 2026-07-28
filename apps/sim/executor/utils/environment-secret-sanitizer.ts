import { createEnvVarPattern } from '@/executor/utils/reference-validation'

interface SecretReplacement {
  value: string
  comparisonValue: string
  normalizePercentEscapes: boolean
  placeholder: string
}

export type EnvironmentSecretSanitizer = <T>(value: T) => T

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function collectReferencedEnvironmentVariables(
  value: unknown,
  referencedNames: Set<string>,
  visited: WeakSet<object>
): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(createEnvVarPattern())) {
      const name = match[1]?.trim()
      if (name) {
        referencedNames.add(name)
      }
    }
    return
  }

  if (value === null || typeof value !== 'object' || visited.has(value)) {
    return
  }
  visited.add(value)

  if (Array.isArray(value)) {
    for (const item of value) {
      collectReferencedEnvironmentVariables(item, referencedNames, visited)
    }
    return
  }

  if (!isPlainObject(value)) {
    return
  }

  for (const [key, item] of Object.entries(value)) {
    collectReferencedEnvironmentVariables(key, referencedNames, visited)
    collectReferencedEnvironmentVariables(item, referencedNames, visited)
  }
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function normalizePercentEscapeCase(value: string): string {
  return value.replace(/%[0-9a-f]{2}/gi, (percentEscape) => percentEscape.toUpperCase())
}

function buildSecretReplacements(
  configuredValue: unknown,
  environmentVariables: Record<string, string>
): SecretReplacement[] {
  const referencedNames = new Set<string>()
  collectReferencedEnvironmentVariables(configuredValue, referencedNames, new WeakSet())

  const replacementsByValue = new Map<string, SecretReplacement>()
  for (const name of [...referencedNames].sort()) {
    const value = environmentVariables[name]
    if (!value) {
      continue
    }

    const placeholder = `{{${name}}}`
    const exactKey = `exact:${value}`
    if (!replacementsByValue.has(exactKey)) {
      replacementsByValue.set(exactKey, {
        value,
        comparisonValue: value,
        normalizePercentEscapes: false,
        placeholder,
      })
    }

    let encodedValue: string
    try {
      encodedValue = encodeURIComponent(value)
    } catch {
      continue
    }

    const encodedVariants = new Set([encodedValue, encodedValue.replaceAll('%20', '+')])
    for (const encodedVariant of encodedVariants) {
      if (encodedVariant === value) {
        continue
      }

      const comparisonValue = normalizePercentEscapeCase(encodedVariant)
      const encodedKey = `encoded:${comparisonValue}`
      if (!replacementsByValue.has(encodedKey)) {
        replacementsByValue.set(encodedKey, {
          value: encodedVariant,
          comparisonValue,
          normalizePercentEscapes: true,
          placeholder,
        })
      }
    }
  }

  return [...replacementsByValue.values()].sort(
    (left, right) =>
      right.value.length - left.value.length ||
      compareStrings(left.placeholder, right.placeholder) ||
      compareStrings(left.comparisonValue, right.comparisonValue)
  )
}

function sanitizeString(value: string, replacements: SecretReplacement[]): string {
  let cursor = 0
  let sanitized = ''
  const percentNormalizedValue = replacements.some(
    (replacement) => replacement.normalizePercentEscapes
  )
    ? normalizePercentEscapeCase(value)
    : value

  while (cursor < value.length) {
    let nextIndex = -1
    let nextReplacement: SecretReplacement | undefined

    for (const replacement of replacements) {
      const source = replacement.normalizePercentEscapes ? percentNormalizedValue : value
      const index = source.indexOf(replacement.comparisonValue, cursor)
      if (index !== -1 && (nextIndex === -1 || index < nextIndex)) {
        nextIndex = index
        nextReplacement = replacement
      }
    }

    if (!nextReplacement) {
      sanitized += value.slice(cursor)
      break
    }

    sanitized += value.slice(cursor, nextIndex)
    sanitized += nextReplacement.placeholder
    cursor = nextIndex + nextReplacement.value.length
  }

  return sanitized
}

function sanitizeValue(
  value: unknown,
  replacements: SecretReplacement[],
  visited: WeakMap<object, unknown>
): unknown {
  if (typeof value === 'string') {
    return sanitizeString(value, replacements)
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  const existing = visited.get(value)
  if (existing !== undefined) {
    return existing
  }

  if (Array.isArray(value)) {
    const sanitized: unknown[] = []
    visited.set(value, sanitized)
    for (const item of value) {
      sanitized.push(sanitizeValue(item, replacements, visited))
    }
    return sanitized
  }

  if (!isPlainObject(value)) {
    return value
  }

  const sanitized = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>
  visited.set(value, sanitized)

  for (const [key, item] of Object.entries(value)) {
    const sanitizedKey = sanitizeString(key, replacements)
    Object.defineProperty(sanitized, sanitizedKey, {
      value: sanitizeValue(item, replacements, visited),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }

  return sanitized
}

/**
 * Creates a sanitizer for observability values using environment variables
 * explicitly referenced by the unresolved block configuration.
 *
 * Runtime values are never changed. Sanitized arrays and plain objects are
 * copied, while unsupported object types are returned unchanged.
 */
export function createEnvironmentSecretSanitizer(
  configuredValue: unknown,
  environmentVariables: Record<string, string>
): EnvironmentSecretSanitizer {
  const replacements = buildSecretReplacements(configuredValue, environmentVariables)

  if (replacements.length === 0) {
    return <T>(value: T): T => value
  }

  return <T>(value: T): T => sanitizeValue(value, replacements, new WeakMap<object, unknown>()) as T
}
