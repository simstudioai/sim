/**
 * Format bytes to human-readable file size
 * e.g. "1.5 MB", "500 KB"
 */
export function formatFileSize(
  bytes: number,
  options?: { includeBytes?: boolean; precision?: number }
): string {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const precision = options?.precision ?? 1
  const includeBytes = options?.includeBytes ?? false

  const i = Math.floor(Math.log(bytes) / Math.log(k))

  if (i === 0 && !includeBytes) {
    return '0 Bytes'
  }

  const value = bytes / k ** i
  const formattedValue = Number.parseFloat(value.toFixed(precision))

  return `${formattedValue} ${sizes[i]}`
}
