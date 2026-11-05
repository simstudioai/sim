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
  if (state === 'stress' && search.get('secrets') === 'organization')
    query.set('secrets', 'organization')
  return query.size ? `${path}?${query}` : path
}

/** A file under `public/`: unlike `next/link` and the router, the browser adds no base path to it. */
export function publicAssetPath(path: string) {
  return `${process.env.NEXT_PUBLIC_SIM_PLATFORM_BASE_PATH ?? ''}${path}`
}

export function readScenario(value: string | string[] | null | undefined) {
  return value === 'empty' || value === 'stress' ? value : 'full'
}
