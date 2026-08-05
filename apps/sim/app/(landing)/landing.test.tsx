/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

vi.mock('@/app/(landing)/components', () => ({
  Cta: () => null,
  Features: () => null,
  Hero: () => null,
  HomeStructuredData: () => null,
  Mothership: () => null,
  ProductDemo: () => null,
}))

vi.mock('@/app/(landing)/components/landing-layout', () => ({
  LANDING_SECTION_RHYTHM: 'gap-test',
}))

vi.mock('@/app/(landing)/landing-analytics', () => ({
  LandingAnalytics: () => <span>landing-analytics-marker</span>,
}))

import Landing from '@/app/(landing)/landing'

describe('Landing', () => {
  it('mounts the landing page analytics tracker exactly once', () => {
    const markup = renderToStaticMarkup(<Landing />)

    expect(markup.match(/landing-analytics-marker/g)).toHaveLength(1)
  })
})
