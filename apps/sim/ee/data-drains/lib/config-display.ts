/** Rendered generically so a new destination's config needs no formatter. */
export function formatConfigValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

/** Config keys carrying these read as initialisms, not words. */
const CONFIG_KEY_ACRONYMS: Record<string, string> = {
  id: 'ID',
  url: 'URL',
  json: 'JSON',
  api: 'API',
}

/**
 * `forcePathStyle` → `Force path style`, `accessKeyId` → `Access key ID`. Sentence
 * case so a new destination field needs no per-key label map.
 */
export function humanizeConfigKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((word) => CONFIG_KEY_ACRONYMS[word] ?? word)
  const [first = '', ...rest] = words
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ')
}
