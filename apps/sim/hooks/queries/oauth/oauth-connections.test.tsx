/**
 * @vitest-environment jsdom
 */

import { act, type ReactNode } from 'react'
import { apiClientRequestMock } from '@sim/testing/mocks/api-client-request.mock'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { libDesktopMock, libDesktopMockFns } from '@sim/testing/mocks/lib-desktop.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)
vi.mock('@/lib/auth/auth-client', () => authClientMock)
vi.mock('@/lib/desktop', () => libDesktopMock)
vi.mock('@/lib/oauth', () => ({ OAUTH_PROVIDERS: {} }))

import { useConnectOAuthService } from '@/hooks/queries/oauth/oauth-connections'

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
