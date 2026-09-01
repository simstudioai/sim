/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { beginOAuthConnect, oauthLink } = vi.hoisted(() => ({
  beginOAuthConnect: vi.fn(),
  oauthLink: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({ requestJson: vi.fn() }))
vi.mock('@/lib/auth/auth-client', () => ({ client: { oauth2: { link: oauthLink } } }))
vi.mock('@/lib/desktop', () => ({
  getDesktopBridge: () =>
    beginOAuthConnect.getMockName() === 'desktop' ? { beginOAuthConnect } : null,
}))
vi.mock('@/lib/oauth', () => ({ OAUTH_PROVIDERS: {} }))

import { useConnectOAuthService } from '@/hooks/queries/oauth/oauth-connections'

describe('useConnectOAuthService', () => {
  let unmount = () => {}

  beforeEach(() => {
    vi.clearAllMocks()
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

  it('supplies the canonical legacy scopes explicitly for web Dataverse links', async () => {
    beginOAuthConnect.mockName('web')
    oauthLink.mockResolvedValue({ data: {}, error: null })
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
        providerId: 'microsoft-dataverse',
        callbackURL: 'https://sim.test/oauth/credential-connected',
        draftId: 'draft-1',
      })
    })

    expect(oauthLink).toHaveBeenCalledWith({
      providerId: 'microsoft-dataverse',
      callbackURL: 'https://sim.test/oauth/credential-connected?credentialDraftId=draft-1',
      scopes: [
        'openid',
        'profile',
        'email',
        'https://dynamics.microsoft.com/user_impersonation',
        'offline_access',
      ],
    })
  })
})
