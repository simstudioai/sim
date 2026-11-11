/**
 * @vitest-environment jsdom
 *
 * Loading paints nothing. Failure mode: the credit figure painting a placeholder dash, and a unit
 * beside it, before the usage read settles.
 */
import { act } from 'react'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UsageCredits } from '@/app/(product)/o/[organizationId]/settings/_components/sections/usage/usage-credits'
import type { useUsageOverview } from '@/platform/lib/data/usage'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it('paints only the heading while the credits are still loading', () => {
  const pending = {
    dimmed: false,
    failed: false,
    retry: () => undefined,
    chart: { loaded: false, used: 0, limit: null, bars: [], series: [], seriesTotals: [] },
  } as unknown as ReturnType<typeof useUsageOverview>
  act(() => root.render(<UsageCredits label='This month' overview={pending} />))
  expect(container.textContent).toBe('This month')
})
