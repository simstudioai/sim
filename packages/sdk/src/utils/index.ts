/**
 * Utility functions for Sim Studio SDK
 */

/**
 * Safely parse a JSON string
 */
export function safeJsonParse<T>(jsonString: string, fallback: T): T {
  try {
    return JSON.parse(jsonString) as T
  } catch (error) {
    return fallback
  }
}

/**
 * Create a template string with variable interpolation
 */
export function template(str: string, variables: Record<string, any>): string {
  return str.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const trimmedPath = path.trim()
    return getValueByPath(variables, trimmedPath)
  })
}

/**
 * Get a nested value from an object using dot notation
 */
export function getValueByPath(obj: any, path: string): any {
  const parts = path.split('.')
  let current = obj

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    current = current[part]
  }

  return current
}

/**
 * Generate a unique ID
 */
export function generateId(prefix = ''): string {
  return `${prefix}${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(deepClone) as unknown as T
  }

  const clone: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj as Record<string, any>)) {
    clone[key] = deepClone(value)
  }

  return clone as T
}

/**
 * Check if two objects are deeply equal
 */
export function deepEquals(a: any, b: any): boolean {
  if (a === b) {
    return true
  }

  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false
  }

  const keysA = Object.keys(a)
  const keysB = Object.keys(b)

  if (keysA.length !== keysB.length) {
    return false
  }

  return keysA.every(key => keysB.includes(key) && deepEquals(a[key], b[key]))
}

/**
 * Format a date string in ISO format
 */
export function formatDate(date: Date = new Date()): string {
  return date.toISOString()
}

/**
 * Convert seconds to a human-readable duration
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`
  }
  
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.round(seconds % 60)
    return `${minutes}m ${remainingSeconds}s`
  }
  
  const hours = Math.floor(seconds / 3600)
  const remainingMinutes = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${remainingMinutes}m`
} 