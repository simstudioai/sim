import { CodeLanguage, DEFAULT_CODE_LANGUAGE, isValidCodeLanguage } from '@/lib/execution/languages'
import { createEnvVarPattern } from '@/executor/utils/reference-validation'

function resolveCodeLanguage(language: unknown): CodeLanguage {
  return typeof language === 'string' && isValidCodeLanguage(language)
    ? language
    : DEFAULT_CODE_LANGUAGE
}

export function createCodeEnvVarPattern(language?: unknown): RegExp {
  return resolveCodeLanguage(language) === CodeLanguage.Shell
    ? /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g
    : createEnvVarPattern()
}

/**
 * Extracts only environment references the Function runtime can resolve for the selected language.
 * The returned order follows the code, with duplicate names removed after their first occurrence.
 */
export function extractCodeSecretNames(code: unknown, language?: unknown): string[] {
  if (typeof code !== 'string') return []

  const resolvedLanguage = resolveCodeLanguage(language)
  const pattern = createCodeEnvVarPattern(resolvedLanguage)
  const names: string[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null

  while ((match = pattern.exec(code)) !== null) {
    const name = resolvedLanguage === CodeLanguage.Shell ? match[1] : match[1].trim()
    if (name.length > 0 && !seen.has(name)) {
      seen.add(name)
      names.push(name)
    }
  }

  return names
}
