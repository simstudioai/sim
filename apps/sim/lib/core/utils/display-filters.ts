import { filterUserFileForDisplay, isUserFile } from '@/lib/core/utils/user-file'

const MAX_STRING_LENGTH = 15000
const MAX_DEPTH = 50

function truncateString(value: string, maxLength = MAX_STRING_LENGTH): string {
  if (value.length <= maxLength) {
    return value
  }
  return `${value.substring(0, maxLength)}... [truncated ${value.length - maxLength} chars]`
}

function filterUserFile(data: any): any {
  if (isUserFile(data)) {
    return filterUserFileForDisplay(data)
  }
  return data
}

const DISPLAY_FILTERS = [filterUserFile]

export function filterForDisplay(data: any): any {
  const seen = new Set<object>()
  return filterForDisplayInternal(data, seen, 0)
}

function getObjectType(data: unknown): string {
  return Object.prototype.toString.call(data).slice(8, -1)
}

function filterForDisplayInternal(data: any, seen: Set<object>, depth: number): any {
  try {
    if (data === null || data === undefined) {
      return data
    }

    const dataType = typeof data

    if (dataType === 'string') {
      // Remove null bytes which are not allowed in PostgreSQL JSONB
      const sanitized = data.includes('\u0000') ? data.replace(/\u0000/g, '') : data
      return truncateString(sanitized)
    }

    if (dataType === 'number') {
      if (Number.isNaN(data)) {
        return '[NaN]'
      }
      if (!Number.isFinite(data)) {
        return data > 0 ? '[Infinity]' : '[-Infinity]'
      }
      return data
    }

    if (dataType === 'boolean') {
      return data
    }

    if (dataType === 'bigint') {
      return `[BigInt: ${data.toString()}]`
    }

    if (dataType === 'symbol') {
      return `[Symbol: ${data.toString()}]`
    }

    if (dataType === 'function') {
      return `[Function: ${data.name || 'anonymous'}]`
    }

    if (dataType !== 'object') {
      return '[Unknown Type]'
    }

    // True circular reference: object is an ancestor in the current path
    if (seen.has(data)) {
      return '[Circular Reference]'
    }

    if (depth > MAX_DEPTH) {
      return '[Max Depth Exceeded]'
    }

    const objectType = getObjectType(data)

    switch (objectType) {
      case 'Date': {
        const timestamp = (data as Date).getTime()
        if (Number.isNaN(timestamp)) {
          return '[Invalid Date]'
        }
        return (data as Date).toISOString()
      }

      case 'RegExp':
        return (data as RegExp).toString()

      case 'URL':
        return (data as URL).toString()

      case 'Error': {
        const err = data as Error
        return {
          name: err.name,
          message: truncateString(err.message),
          stack: err.stack ? truncateString(err.stack) : undefined,
        }
      }

      case 'ArrayBuffer':
        return `[ArrayBuffer: ${(data as ArrayBuffer).byteLength} bytes]`

      case 'Map': {
        seen.add(data)
        const obj: Record<string, any> = {}
        for (const [key, value] of (data as Map<any, any>).entries()) {
          const keyStr = typeof key === 'string' ? key : String(key)
          obj[keyStr] = filterForDisplayInternal(value, seen, depth + 1)
        }
        seen.delete(data)
        return obj
      }

      case 'Set': {
        seen.add(data)
        const result = Array.from(data as Set<any>).map((item) =>
          filterForDisplayInternal(item, seen, depth + 1)
        )
        seen.delete(data)
        return result
      }

      case 'WeakMap':
        return '[WeakMap]'

      case 'WeakSet':
        return '[WeakSet]'

      case 'WeakRef':
        return '[WeakRef]'

      case 'Promise':
        return '[Promise]'
    }

    if (ArrayBuffer.isView(data)) {
      return `[${objectType}: ${(data as ArrayBufferView).byteLength} bytes]`
    }

    // Add to current path before processing children
    seen.add(data)

    for (const filterFn of DISPLAY_FILTERS) {
      const filtered = filterFn(data)
      if (filtered !== data) {
        const result = filterForDisplayInternal(filtered, seen, depth + 1)
        seen.delete(data)
        return result
      }
    }

    if (Array.isArray(data)) {
      const result = data.map((item) => filterForDisplayInternal(item, seen, depth + 1))
      seen.delete(data)
      return result
    }

    const result: Record<string, any> = {}
    for (const key of Object.keys(data)) {
      try {
        result[key] = filterForDisplayInternal(data[key], seen, depth + 1)
      } catch {
        result[key] = '[Error accessing property]'
      }
    }
    // Remove from current path after processing children
    seen.delete(data)
    return result
  } catch {
    return '[Unserializable]'
  }
}
