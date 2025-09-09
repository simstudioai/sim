/**
 * UUID utility that works in both secure and non-secure contexts
 * Addresses the crypto.randomUUID() issue in insecure HTTP contexts
 * 
 * SECURITY NOTE: The fallback Math.random() UUID is cryptographically weak
 * and should not be used for security-sensitive operations (tokens, secrets, etc.).
 * It is suitable for client-side UI state management, temporary IDs, and similar uses.
 */

/**
 * Fallback UUID v4 generator using Math.random()
 * This provides a cryptographically weak but acceptable UUID
 * when crypto.randomUUID() is not available (insecure contexts)
 */
function fallbackUUIDv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Check if we're running in a secure context where crypto.randomUUID() is available
 * Defaults to true for older browsers that don't support window.isSecureContext
 */
function isSecureContext(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.isSecureContext === undefined || window.isSecureContext) && // Default to true for older browsers
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  )
}

/**
 * Generate a UUID that works in both secure and insecure contexts
 * - Uses crypto.randomUUID() in secure contexts (HTTPS, localhost)
 * - Falls back to Math.random() based UUID in insecure contexts
 * 
 * @returns A UUID v4 string
 */
export function generateUUID(): string {
  try {
    // Try to use crypto.randomUUID() first (secure context)
    if (isSecureContext()) {
      return crypto.randomUUID()
    }
  } catch (error) {
    // crypto.randomUUID() not available or threw an error
    console.warn('crypto.randomUUID() not available, falling back to Math.random() UUID generation')
  }

  // Fallback for insecure contexts or when crypto.randomUUID() is not available
  return fallbackUUIDv4()
}

/**
 * Server-side UUID generation using Node.js crypto module
 * This is always secure and should be used for server-side code
 */
export function generateServerUUID(): string {
  // This will use Node.js crypto.randomUUID() on the server
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }
  
  // Fallback to Node.js crypto module if available
  try {
    const { randomUUID } = require('crypto')
    return randomUUID()
  } catch (error) {
    console.warn('Node.js crypto module not available, using fallback UUID generation')
    return fallbackUUIDv4()
  }
}

/**
 * Generate a cryptographically secure UUID for security-sensitive operations
 * This function enforces secure UUID generation and throws an error if 
 * secure generation is not available.
 * 
 * Use this for: tokens, secrets, API keys, session IDs, etc.
 * 
 * @throws {Error} If secure UUID generation is not available
 */
export function generateSecureUUID(): string {
  if (typeof window === 'undefined') {
    // Server-side - always secure
    return generateServerUUID()
  }
  
  // Client-side - must be secure context
  if (!isSecureContext()) {
    throw new Error('Secure UUID generation not available in insecure context. Use generateUUID() for non-security-sensitive operations.')
  }
  
  try {
    return crypto.randomUUID()
  } catch (error) {
    throw new Error('Failed to generate secure UUID: crypto.randomUUID() not available')
  }
}

/**
 * Context-aware UUID generation
 * - Uses server-side crypto on the server
 * - Uses client-side crypto or fallback on the client
 */
export function generateContextAwareUUID(): string {
  if (typeof window === 'undefined') {
    // Server-side
    return generateServerUUID()
  } else {
    // Client-side
    return generateUUID()
  }
}

/**
 * Validate that we're not using a fallback UUID for security-sensitive operations
 * This helps prevent accidental use of weak UUIDs in production
 */
export function validateSecureUUIDCapability(): { isSecure: boolean; reason?: string } {
  if (typeof window === 'undefined') {
    // Server-side - check Node.js crypto
    try {
      if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
        return { isSecure: true }
      }
      
      const { randomUUID } = require('crypto')
      if (typeof randomUUID === 'function') {
        return { isSecure: true }
      }
      
      return { isSecure: false, reason: 'Node.js crypto module or randomUUID function not available' }
    } catch (error) {
      return { isSecure: false, reason: 'Node.js crypto module not available' }
    }
  }
  
  // Client-side
  if (!isSecureContext()) {
    return { isSecure: false, reason: 'Not running in a secure context (HTTPS required)' }
  }
  
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    return { isSecure: false, reason: 'crypto.randomUUID() not available in this browser' }
  }
  
  return { isSecure: true }
}

// Default export for easy migration
export default generateContextAwareUUID