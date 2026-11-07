/** A route on the legacy surface is named by its absolute URL; Next's router must not handle it. */
export function isAbsoluteHref(href: string): boolean {
  return /^https?:\/\//.test(href)
}

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

/** Keep the selected fixture and appearance when moving between product routes. */
export function platformHref(path: string, search: SearchValues) {
  if (isAbsoluteHref(path)) return path
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

/** Keep the active directory filters on a result and its link back to the list. */
export function directoryHref(
  path: string,
  search: SearchValues,
  query = search.get('q'),
  category = search.get('category')
) {
  const destination = platformHref(path, search)
  const filters = new URLSearchParams()
  if (query) filters.set('q', query)
  if (category && category !== 'All') filters.set('category', category)
  return filters.size
    ? `${destination}${destination.includes('?') ? '&' : '?'}${filters}`
    : destination
}

/** A file under `public/`: unlike `next/link` and the router, the browser adds no base path to it. */
export function publicAssetPath(path: string) {
  return `${process.env.NEXT_PUBLIC_SIM_PLATFORM_BASE_PATH ?? ''}${path}`
}

export function readScenario(value: string | string[] | null | undefined) {
  return value === 'empty' || value === 'stress' ? value : 'full'
}
