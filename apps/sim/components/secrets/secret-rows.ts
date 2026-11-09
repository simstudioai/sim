import { setRecordValue } from '@/lib/core/utils/records'
import { toast } from '@/lib/toast/sink'
import { isValidEnvVarName } from '@/executor/constants'

/** Copies a secret's name and confirms with a toast. */
export function copySecretName(key: string) {
  void navigator.clipboard.writeText(key)
  toast.success('Copied name to clipboard')
}

export const generateRowId = (() => {
  let counter = 0
  return () => {
    counter += 1
    return Date.now() + counter
  }
})()

export const createEmptyEnvVar = (): UIEnvironmentVariable => ({
  key: '',
  value: '',
  id: generateRowId(),
})

export interface UIEnvironmentVariable {
  key: string
  value: string
  id?: number
}

/**
 * Updates an env var array with auto-add (new empty row when typing in last)
 * and auto-remove (drop non-last empty rows).
 */
export function updateEnvVarArray(
  vars: UIEnvironmentVariable[],
  index: number,
  field: 'key' | 'value',
  value: string
): UIEnvironmentVariable[] {
  const updated = [...vars]
  if (updated[index]) {
    updated[index] = { ...updated[index], [field]: value }
  }

  const lastIdx = updated.length - 1
  if (index === lastIdx && updated[lastIdx] && (updated[lastIdx].key || updated[lastIdx].value)) {
    updated.push(createEmptyEnvVar())
  }

  const lastIndex = updated.length - 1
  return updated.filter((v, i) => i === lastIndex || v.key !== '' || v.value !== '')
}

export function applyVariableEdits(
  baseline: Record<string, string>,
  edited: Record<string, string>,
  latest: Record<string, string>
): Record<string, string> {
  const merged = { ...latest }
  for (const [key, value] of Object.entries(edited)) {
    if (baseline[key] !== value) setRecordValue(merged, key, value)
  }
  for (const key of Object.keys(baseline)) {
    if (!Object.hasOwn(edited, key)) delete merged[key]
  }
  return merged
}

/**
 * Validates an environment variable key.
 * Returns an error message if invalid, undefined if valid.
 */
export function validateEnvVarKey(key: string): string | undefined {
  if (!key) return undefined
  if (key.includes(' ')) return 'Spaces are not allowed'
  if (!isValidEnvVarName(key)) return 'Only letters, numbers, and underscores allowed'
  return undefined
}

/**
 * Parses a single `.env`-style line into a key/value pair.
 * Handles `export KEY=VALUE`, quoted values, inline comments, and base64 false positives.
 * Returns null for blank lines, comments, and invalid entries.
 */
export function parseEnvVarLine(line: string): UIEnvironmentVariable | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null

  const withoutExport = trimmed.replace(/^export\s+/, '')
  const equalIndex = withoutExport.indexOf('=')
  if (equalIndex === -1 || equalIndex === 0) return null

  const potentialKey = withoutExport.substring(0, equalIndex).trim()
  if (!isValidEnvVarName(potentialKey)) return null

  let value = withoutExport.substring(equalIndex + 1)

  const looksLikeBase64Key = /^[A-Za-z0-9+/]+$/.test(potentialKey) && !potentialKey.includes('_')
  const valueIsJustPadding = /^=+$/.test(value.trim())
  if (looksLikeBase64Key && valueIsJustPadding && potentialKey.length > 20) return null

  const trimmedValue = value.trim()
  if (
    !trimmedValue.startsWith('"') &&
    !trimmedValue.startsWith("'") &&
    !trimmedValue.startsWith('`')
  ) {
    const commentIndex = value.search(/\s#/)
    if (commentIndex !== -1) value = value.substring(0, commentIndex)
  }

  value = value.trim()

  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('`') && value.endsWith('`')))
  ) {
    value = value.slice(1, -1)
  }

  return { key: potentialKey, value, id: generateRowId() }
}

/** Parses an array of raw text lines, returning only valid non-empty KEY=VALUE entries. */
export function parseValidEnvVars(lines: string[]): UIEnvironmentVariable[] {
  const result: UIEnvironmentVariable[] = []
  for (const line of lines) {
    const parsed = parseEnvVarLine(line)
    if (parsed?.key && parsed.value) {
      result.push(parsed)
    }
  }
  return result
}
