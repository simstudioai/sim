/** Public asset origin already used by Sim's Academy recordings. */
export const CHANGELOG_MEDIA_ORIGIN = 'https://nnjgp7vypgx4myuq.public.blob.vercel-storage.com'

/** Shared by rendering and content validation; CSP imports this leaf before aliases resolve. */
export function isChangelogMediaSource(source: string): boolean {
  if (typeof source !== 'string' || /[\r\n\t\\]/.test(source)) return false
  if (source.startsWith('/') && !source.startsWith('//')) return true
  try {
    const url = new URL(source)
    return url.origin === CHANGELOG_MEDIA_ORIGIN && !url.username && !url.password
  } catch {
    return false
  }
}
