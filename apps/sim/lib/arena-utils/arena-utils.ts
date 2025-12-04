export function startOfDayTimestamp(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0') // months are 0-based
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day} 00:00:00`
}

/**
 * Validate if a given string is a proper URL
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url) // Will throw if invalid
    return true
  } catch {
    return false
  }
}

export function isValidDate(value: any): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime())
}
