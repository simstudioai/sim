/** @vitest-environment jsdom */

import { act } from 'react'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import {
  kbConnectorsQueriesMock,
  kbConnectorsQueriesMockFns,
} from '@sim/testing/mocks/kb-connectors-queries.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/auth/client', () => authClientMock)
vi.mock('@/hooks/queries/kb/connectors', () => kbConnectorsQueriesMock)
vi.mock('@/hooks/queries/search-integrations', () => ({
  useUpdateSearchIntegration: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({
    integrationAvailability: new Map(),
    oauthServiceAvailability: new Map(),
    isIntegrationAvailabilityReady: true,
    isIntegrationAvailabilityLoading: false,
    integrationAvailabilityError: null,
    refetchIntegrationAvailability: vi.fn(),
  }),
}))

import { SourceSetup } from '@/platform/app/(shell)/settings/_components/sections/integrations/source-setup-host'

const mockReplace = nextNavigationMockFns.router.replace

describe('organization source setup redirects', () => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mockReplace.mockClear()
    authClientMockFns.mockUseSession.mockReturnValue({ data: { user: { id: 'user-1' } } })
    kbConnectorsQueriesMockFns.mockUsePrepareSearchSource.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: null,
    })
    kbConnectorsQueriesMockFns.mockUseSearchIndex.mockReturnValue({ isPending: true })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it.each([
    ['source-one', '/o/org-1/settings/integrations/sources/source-one'],
    ['confluence', '/o/org-1/settings/integrations'],
    ['', '/o/org-1/settings/integrations'],
  ])(
    'redirects legacy organization management for %s without opening a dialog',
    async (source, destination) => {
      await act(async () =>
        root.render(
          <NuqsTestingAdapter searchParams={`?manage-source=${source}`}>
            <SourceSetup
              scope={{ kind: 'organization', organizationId: 'org-1' }}
              backLabel='Slack'
              canAdmin
              memberAccessAvailable
              mirroredAccessAvailable
            >
              <p>Connections</p>
            </SourceSetup>
          </NuqsTestingAdapter>
        )
      )
      if (source === 'source-one') expect(mockReplace).toHaveBeenCalledWith(destination)
      else expect(mockReplace).not.toHaveBeenCalled()
      expect(document.querySelector('dialog[open]')).toBeNull()
      expect(container.textContent).toContain('Connections')
    }
  )
})
