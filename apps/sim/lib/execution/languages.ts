/**
 * Supported code execution languages
 */
export enum CodeLanguage {
  JavaScript = 'javascript',
  Python = 'python',
}

/**
 * Type guard to check if a string is a valid CodeLanguage
 */
export function isValidCodeLanguage(value: string): value is CodeLanguage {
  return Object.values(CodeLanguage).includes(value as CodeLanguage)
}

/**
 * Get language display name
 */
export function getLanguageDisplayName(language: CodeLanguage): string {
  switch (language) {
    case CodeLanguage.JavaScript:
      return 'JavaScript'
    case CodeLanguage.Python:
      return 'Python'
    default:
      return language
  }
}

/**
 * Default language for code execution
 */
export const DEFAULT_CODE_LANGUAGE = CodeLanguage.JavaScript
