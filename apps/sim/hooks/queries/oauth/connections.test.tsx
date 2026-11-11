/**
 * @vitest-environment jsdom
 */

import { act, type ReactNode } from 'react'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { libDesktopMock, libDesktopMockFns } from '@sim/testing/mocks/lib-desktop.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)
vi.mock('@/lib/auth/client', () => authClientMock)
vi.mock('@/lib/desktop', () => libDesktopMock)
const { oauthProviders } = vi.hoisted(() => ({
  oauthProviders: {} as Record<string, { services: Record<string, unknown> }>,
}))
vi.mock('@/lib/oauth', () => ({ OAUTH_PROVIDERS: oauthProviders }))

import { useConnectOAuthService, useOAuthConnections } from '@/hooks/queries/oauth/connections'

const beginOAuthConnect = vi.fn()
const oauthLink = authClientMockFns.mockClient.oauth2.link
libDesktopMockFns.mockGetDesktopBridge.mockImplementation(() =>
  beginOAuthConnect.getMockName() === 'desktop' ? { beginOAuthConnect } : undefined
)

describe('useConnectOAuthService', () => {
  let unmount = () => {}

  beforeEach(() => {
    beginOAuthConnect.mockName('desktop')
    beginOAuthConnect.mockResolvedValue(true)
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => unmount())

  it.each(['trello', 'instagram', 'shopify'])(
    'hands %s to the desktop bridge before provider-specific web routing',
    async (providerId) => {
      const queryClient = new QueryClient({
        defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
      })
      const container = document.createElement('div')
      const root = createRoot(container)
      let connect: ReturnType<typeof useConnectOAuthService> | undefined
      function Probe() {
        connect = useConnectOAuthService()
        return null
      }
      function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      }
      act(() =>
        root.render(
          <Wrapper>
            <Probe />
          </Wrapper>
        )
      )
      unmount = () => act(() => root.unmount())

      await act(async () => {
        await connect?.mutateAsync({
          providerId,
          callbackURL: 'https://sim.test/oauth/credential-connected',
          draftId: 'draft-1',
        })
      })

      expect(beginOAuthConnect).toHaveBeenCalledWith(providerId, { draftId: 'draft-1' })
      expect(oauthLink).not.toHaveBeenCalled()
    }
  )
})

describe('useOAuthConnections', () => {
  afterEach(() => {
    for (const key of Object.keys(oauthProviders)) delete oauthProviders[key]
  })

  it('never marks a token-only service connected from a sign-in account sharing its prefix', async () => {
    oauthProviders['github-token'] = {
      services: {
        'github-token': {
          name: 'GitHub',
          providerId: 'github-token',
          serviceAccountProviderId: 'github-service-account',
          authType: 'service_account',
          scopes: [],
        },
      },
    }
    oauthProviders.dub = {
      services: { dub: { name: 'Dub', providerId: 'dub', scopes: [] } },
    }
    apiClientRequestMockFns.mockRequestJson.mockResolvedValue({
      connections: [
        {
          provider: 'github',
          baseProvider: 'github',
          featureType: 'default',
          isConnected: true,
          scopes: ['read:user'],
          lastConnected: '2026-11-01T00:00:00.000Z',
          accounts: [{ id: 'sign-in', name: 'octo (GitHub)' }],
        },
        {
          provider: 'dub-legacy',
          baseProvider: 'dub',
          featureType: 'default',
          isConnected: true,
          scopes: [],
          lastConnected: '2026-11-01T00:00:00.000Z',
          accounts: [{ id: 'dub-account', name: 'Dub' }],
        },
      ],
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const container = document.createElement('div')
    const root = createRoot(container)
    let services: ReturnType<typeof useOAuthConnections>['data']
    function Probe() {
      services = useOAuthConnections().data
      return null
    }
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>
      )
    })
    await vi.waitFor(() => expect(services).toBeDefined())

    expect(services?.find((service) => service.id === 'github-token')?.isConnected).toBe(false)
    expect(services?.find((service) => service.id === 'dub')?.isConnected).toBe(true)
    act(() => root.unmount())
  })
})
