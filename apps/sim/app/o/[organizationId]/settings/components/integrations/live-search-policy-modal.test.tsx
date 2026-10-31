/** @vitest-environment jsdom */

import { act } from 'react'
import {
  kbConnectorsQueriesMock,
  kbConnectorsQueriesMockFns,
} from '@sim/testing/mocks/kb-connectors-queries.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import { LiveSearchPolicyModal } from '@/app/o/[organizationId]/settings/components/integrations/live-search-policy-modal'

const mocks = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/hooks/queries/kb/connectors', () => kbConnectorsQueriesMock)
vi.mock('@/hooks/queries/search-integrations', () => ({
  useUpdateSearchIntegration: () => ({ mutate: mocks.save }),
}))
const mockPush = nextNavigationMockFns.router.push
const mockSources = kbConnectorsQueriesMockFns.mockUseSearchSources
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  mockSources.mockReturnValue({ data: [], hasNextPage: false })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
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
        <LiveSearchPolicyModal
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
    await act(async () => button('Member accounts').click())
    await act(async () => button('Save settings').click())
    expect(mocks.save).toHaveBeenCalledWith(
      {
        organizationId: 'org',
        connectorType: 'gmail',
        approved: true,
        policy: defaultLiveSearchPolicy(),
      },
      expect.any(Object)
    )
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
        <LiveSearchPolicyModal
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
    await act(async () => button('Add connection').click())
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: expect.objectContaining({ sourceId: 'current-source' }),
      }),
      expect.any(Object)
    )
    expect(mockPush).not.toHaveBeenCalled()
    await act(async () => mocks.save.mock.calls.at(-1)?.[1].onSuccess())
    expect(mockPush).toHaveBeenCalledWith(
      '/o/org/settings/integrations/providers/gmail?addConnector=gmail'
    )
  })
  it('preserves a configured source while its paginated inventory is loading', async () => {
    mockSources.mockReturnValue({ isPending: true, hasNextPage: false })
    await act(async () =>
      root.render(
        <LiveSearchPolicyModal
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
      }),
      expect.any(Object)
    )
  })
})
