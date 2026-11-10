import { parseAsStringLiteral } from 'nuqs/server'

export type Appearance = 'system' | 'light' | 'dark'

/** A fixture build's appearance, chosen in the URL (`?theme=`). */
export const fixtureAppearanceParam = {
  key: 'theme',
  parser: parseAsStringLiteral(['system', 'light', 'dark'] as const).withDefault('system'),
} as const

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

/**
 * Keep a fixture build's selected scenario and appearance on a complete product path (`surfaceHref`,
 * `workspacePath`). A live build, and an external address from data, return the path untouched.
 */
export function platformHref(path: string, search: SearchValues) {
  if (process.env.SIM_PLATFORM_FIXTURES !== '1' || /^https?:\/\//.test(path)) return path
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
