import { analyzeCodePlaceholders } from '@/lib/execution/code-placeholders'
import {
  type CodeLanguage,
  DEFAULT_CODE_LANGUAGE,
  isValidCodeLanguage,
} from '@/lib/execution/languages'

function resolveCodeLanguage(language: unknown): CodeLanguage {
  return typeof language === 'string' && isValidCodeLanguage(language)
    ? language
    : DEFAULT_CODE_LANGUAGE
}

/**
 * Extracts only environment references the Function runtime can resolve for the selected language.
 * The returned order follows the code, with duplicate names removed after their first occurrence.
 */
export async function extractCodeSecretNames(code: unknown, language?: unknown): Promise<string[]> {
  if (typeof code !== 'string') return []
  return analyzeCodePlaceholders(code, resolveCodeLanguage(language))
}
