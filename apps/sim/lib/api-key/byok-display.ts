/** Produces the existing partial BYOK display without returning the usable credential. */
export function maskByokApiKey(key: string): string {
  if (key.length <= 8) return '•'.repeat(8)
  if (key.length <= 12) return `${key.slice(0, 4)}...${key.slice(-4)}`
  return `${key.slice(0, 6)}...${key.slice(-4)}`
}
