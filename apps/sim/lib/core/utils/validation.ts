import { getBaseUrl } from './urls'

/**
 * Checks if a URL is same-origin with the application's base URL.
 * Used to prevent open redirect vulnerabilities.
 *
 * @param url - The URL to validate
 * @returns True if the URL is same-origin, false otherwise (secure default)
 */
export function isSameOrigin(url: string): boolean {
  try {
    const targetUrl = new URL(url)
    const appUrl = new URL(getBaseUrl())
    return targetUrl.origin === appUrl.origin
  } catch {
    return false
  }
}

/**
 * Validates a name by removing any characters that could cause issues
 * with variable references or node naming.
 *
 * @param name - The name to validate
 * @returns The validated name with invalid characters removed, trimmed, and collapsed whitespace
 */
export function validateName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_\s]/g, '') // Remove invalid characters
    .replace(/\s+/g, ' ') // Collapse multiple spaces into single spaces
}

/**
 * Checks if a name contains invalid characters
 *
 * @param name - The name to check
 * @returns True if the name is valid, false otherwise
 */
export function isValidName(name: string): boolean {
  return /^[a-zA-Z0-9_\s]*$/.test(name)
}

/**
 * Gets a list of invalid characters in a name
 *
 * @param name - The name to check
 * @returns Array of invalid characters found
 */
export function getInvalidCharacters(name: string): string[] {
  const invalidChars = name.match(/[^a-zA-Z0-9_\s]/g)
  return invalidChars ? [...new Set(invalidChars)] : []
}

/**
 * Escapes non-ASCII characters in JSON string for HTTP header safety.
 * Dropbox API requires characters 0x7F and all non-ASCII to be escaped as \uXXXX.
 */
export function httpHeaderSafeJson(value: object): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (c) => {
    return `\\u${(`0000${c.charCodeAt(0).toString(16)}`).slice(-4)}`
  })
}
