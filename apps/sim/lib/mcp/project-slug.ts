const MAX_SLUG_LENGTH = 64

export function normalizeProjectSlug(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)

  return normalized.length > 0 ? normalized : 'server'
}

export { MAX_SLUG_LENGTH }
