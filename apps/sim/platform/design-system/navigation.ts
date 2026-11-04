export type Appearance = 'system' | 'light' | 'dark'

interface SearchValues {
  get(key: string): string | null
}

/** Keep the selected fixture and appearance when moving between product routes. */
export function platformHref(path: string, search: SearchValues) {
  const query = new URLSearchParams()
  const state = search.get('state')
  const theme = search.get('theme')
  if (state === 'empty' || state === 'full' || state === 'stress') query.set('state', state)
  if (theme === 'system' || theme === 'light' || theme === 'dark') query.set('theme', theme)
  return query.size ? `${path}?${query}` : path
}
