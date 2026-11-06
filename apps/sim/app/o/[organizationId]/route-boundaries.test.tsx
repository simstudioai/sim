/** @vitest-environment jsdom */

import { act, type ReactNode } from 'react'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrganizationAccessDenied } from '@/app/o/[organizationId]/components/organization-access-denied'
import OrganizationError from '@/app/o/[organizationId]/error'
import OrganizationNotFound from '@/app/o/[organizationId]/not-found'

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/app/_shell/desktop-title-bar', () => ({ DesktopTitleBarLane: () => null }))

const mountedRoots: Root[] = []

function mount(element: ReactNode) {
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  mountedRoots.push(root)
  act(() => root.render(element))
  return container
}

// A root left mounted lets React's scheduler run after jsdom's teardown removes `window`.
afterEach(() => {
  act(() => {
    for (const root of mountedRoots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
})

/**
 * Failure mode: the thing that failed is what a boundary would otherwise read. Each renders here
 * with no OrganizationProvider, query client, feature flags or store seeded around it.
 */
describe('organization route boundaries with nothing around them', () => {
  beforeEach(() => {
    stubResizeObserver()
  })

  it('error offers Try again', () => {
    const page = mount(<OrganizationError error={new Error('provider failed')} reset={vi.fn()} />)
    expect(page.querySelector('button')?.textContent).toBe('Try again')
  })

  it('not found offers a way home', () => {
    const page = mount(<OrganizationNotFound />)
    expect(page.querySelector('h1')?.textContent).toBe('Page not found')
    expect(page.querySelector('a')?.textContent).toBe('Return home')
  })

  it('access denied offers the workspaces', () => {
    const page = mount(<OrganizationAccessDenied />)
    expect(page.querySelector('a')?.textContent).toBe('View your workspaces')
  })
})
