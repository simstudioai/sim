export type Appearance = 'system' | 'light' | 'dark'

export function readAppearance(value: string | string[] | null | undefined): Appearance {
  const theme = Array.isArray(value) ? value[0] : value
  return theme === 'light' || theme === 'dark' ? theme : 'system'
}

export type PreviewPlan = 'free' | 'team' | 'enterprise'

export function readPreviewPlan(value: string | string[] | null | undefined): PreviewPlan {
  return value === 'free' || value === 'team' ? value : 'enterprise'
}

interface SearchValues {
  get(key: string): string | null
}

/** Keep the selected fixture and appearance on a complete product path (`surfaceHref`, `workspacePath`). */
export function platformHref(path: string, search: SearchValues) {
  // An external address from data passes through untouched.
  if (/^https?:\/\//.test(path)) return path
  const destination = new URL(path, 'https://platform.invalid')
  const query = destination.searchParams
  const state = search.get('state')
  const theme = search.get('theme')
  const plan = readPreviewPlan(search.get('plan'))
  if (plan !== 'enterprise') query.set('plan', plan)
  if (state === 'empty' || state === 'full' || state === 'stress') query.set('state', state)
  if (theme === 'system' || theme === 'light' || theme === 'dark') query.set('theme', theme)
  if (state === 'stress' && search.get('secrets') === 'organization')
    query.set('secrets', 'organization')
  return `${destination.pathname}${destination.search}${destination.hash}`
}

export function readScenario(value: string | string[] | null | undefined) {
  return value === 'empty' || value === 'stress' ? value : 'full'
}
