export type Appearance = 'system' | 'light' | 'dark'

export function readAppearance(value: string | string[] | null | undefined): Appearance {
  const theme = Array.isArray(value) ? value[0] : value
  return theme === 'light' || theme === 'dark' ? theme : 'system'
}

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
  if (search.get('role') === 'member') query.set('role', 'member')
  return query.size ? `${path}?${query}` : path
}

export function readScenario(value: string | string[] | null | undefined) {
  return value === 'empty' || value === 'stress' ? value : 'full'
}
