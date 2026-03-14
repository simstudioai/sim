/**
 * Generate a UUID v4 string that works in all contexts.
 *
 * crypto.randomUUID() is only available in secure contexts (HTTPS).
 * In non-secure contexts (HTTP), it throws a TypeError.
 * This utility provides a fallback implementation.
 *
 * @returns A UUID v4 string (e.g., "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx")
 */
export function generateId(): string {
  // In Node.js (server-side) or secure browser contexts, use native API
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID()
    } catch {
      // Fall through to manual implementation
    }
  }

  // Fallback: manual UUID v4 generation using getRandomValues
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    // Last resort: Math.random (not cryptographically secure, but functional)
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }

  // Set version (4) and variant (RFC 4122) bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
  return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`
}
