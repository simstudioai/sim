/** @vitest-environment jsdom */

import { act } from 'react'
import { stubDialogMethods, stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import {
  kbConnectorsQueriesMock,
  kbConnectorsQueriesMockFns,
} from '@sim/testing/mocks/kb-connectors-queries.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import { PolicyModal } from '@/platform/embedded/app/(shell)/settings/_components/sections/integrations/policy-modal'

const mocks = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/hooks/queries/kb/connectors', () => kbConnectorsQueriesMock)
vi.mock('@/hooks/queries/search-integrations', () => ({
  useUpdateSearchIntegration: () => ({ mutateAsync: mocks.save }),
}))
const mockPush = nextNavigationMockFns.router.push
const mockSources = kbConnectorsQueriesMockFns.mockUseSearchSources
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  mocks.save.mockReset()
  mocks.save.mockReturnValue(new Promise(() => {}))
  mockSources.mockReturnValue({ data: [], hasNextPage: false })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Element.prototype.checkVisibility = () => true
  stubDialogMethods()
  stubResizeObserver()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})
function button(label: string) {
  const element = [...document.querySelectorAll('button')].find(
    (element) => element.textContent === label
  )
  if (!element) throw new Error(`Missing button: ${label}`)
  return element
}
describe('live search policy source preservation', () => {
  it('switches to member mode without carrying service-account filters or credentials', async () => {
    await act(async () =>
      root.render(
        <PolicyModal
          organizationId='org'
          integration={{
            connectorType: 'gmail',
            approved: true,
            policy: {
              ...defaultLiveSearchPolicy(),
              accessMode: 'service_account',
              sourceId: 'source',
              mode: 'selected',
              included: ['INBOX'],
              excludePromotions: true,
            },
          }}
          onClose={vi.fn()}
        />
      )
    )
    await act(async () =>
      document.querySelector<HTMLInputElement>('input[type="radio"][value="member"]')?.click()
    )
    await act(async () => button('Save settings').click())
    expect(mocks.save).toHaveBeenCalledWith({
      organizationId: 'org',
      connectorType: 'gmail',
      approved: true,
      policy: defaultLiveSearchPolicy(),
    })
  })
  it('can add another connection without clearing the currently configured source', async () => {
    mockSources.mockReturnValue({
      data: [
        {
          connectorId: 'current-source',
          sourceDescription: 'Existing service account',
          accessMode: 'admin',
          enabled: true,
          availability: 'available',
        },
      ],
      hasNextPage: false,
    })
    await act(async () =>
      root.render(
        <PolicyModal
          organizationId='org'
          integration={{
            connectorType: 'gmail',
            approved: true,
            policy: {
              ...defaultLiveSearchPolicy(),
              accessMode: 'service_account',
              sourceId: 'current-source',
            },
          }}
          onClose={vi.fn()}
        />
      )
    )
    let saved = () => {}
    mocks.save.mockReturnValue(
      new Promise<void>((resolve) => {
        saved = resolve
      })
    )
    await act(async () => button('Add connection').click())
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: expect.objectContaining({ sourceId: 'current-source' }),
      })
    )
    expect(mockPush).not.toHaveBeenCalled()
    await act(async () => saved())
    expect(mockPush).toHaveBeenCalledWith(
      '/o/org/settings/integrations/providers/gmail?addConnector=gmail'
    )
  })
  it('preserves a configured source while its paginated inventory is loading', async () => {
    mockSources.mockReturnValue({ isPending: true, hasNextPage: false })
    await act(async () =>
      root.render(
        <PolicyModal
          organizationId='org'
          integration={{
            connectorType: 'gmail',
            approved: true,
            policy: {
              ...defaultLiveSearchPolicy(),
              accessMode: 'service_account',
              sourceId: 'configured-source',
            },
          }}
          onClose={vi.fn()}
        />
      )
    )
    await act(async () => button('Save settings').click())
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: expect.objectContaining({
          accessMode: 'service_account',
          sourceId: 'configured-source',
        }),
      })
    )
  })
})
