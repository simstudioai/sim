/**
 * Utility functions for file parsing
 */

/**
 * Clean text content to ensure it's safe for UTF-8 storage in PostgreSQL
 * Removes null bytes and control characters that can cause encoding errors
 */
export function sanitizeTextForUTF8(text: string): string {
  if (!text || typeof text !== 'string') {
    return ''
  }

  return text
    .replace(/\0/g, '') // Remove null bytes (0x00)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters except \t(0x09), \n(0x0A), \r(0x0D)
    .replace(/\uFFFD/g, '') // Remove Unicode replacement character
    .replace(/[\uD800-\uDFFF]/g, '') // Remove unpaired surrogate characters
}

/**
 * Sanitize an array of strings
 */
export function sanitizeTextArray(texts: string[]): string[] {
  return texts.map((text) => sanitizeTextForUTF8(text))
}

/**
 * Check if a string contains problematic characters for UTF-8 storage
 */
export function hasInvalidUTF8Characters(text: string): boolean {
  if (!text || typeof text !== 'string') {
    return false
  }

  // Check for null bytes and control characters
  return (
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text) ||
    /\uFFFD/.test(text) ||
    /[\uD800-\uDFFF]/.test(text)
  )
}
