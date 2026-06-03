import { getBaseUrl } from './urls'

/**
 * Checks if a URL is same-origin with a base URL. Defaults to the application's
 * base URL, used to prevent open redirect vulnerabilities; pass an explicit
 * `base` to pin a URL to another trusted origin (e.g. a configured API host)
 * before following it with credentials.
 *
 * @param url - The URL to validate
 * @param base - The origin to compare against (defaults to the app base URL)
 * @returns True if the URL is same-origin, false otherwise (secure default)
 */
export function isSameOrigin(url: string, base: string = getBaseUrl()): boolean {
  try {
    return new URL(url).origin === new URL(base).origin
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
