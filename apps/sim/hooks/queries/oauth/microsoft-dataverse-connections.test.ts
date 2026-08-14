/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBeginOAuthConnect, mockLink } = vi.hoisted(() => ({
  mockBeginOAuthConnect: vi.fn(),
  mockLink: vi.fn(),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  client: { oauth2: { link: mockLink } },
}))

vi.mock('@/lib/desktop', () => ({
  getDesktopBridge: () =>
    mockBeginOAuthConnect.mock.calls.length >= 0 &&
    mockBeginOAuthConnect.getMockName() === 'desktop'
      ? { beginOAuthConnect: mockBeginOAuthConnect }
      : null,
}))

import { getMicrosoftDataverseRequiredScope } from '@/lib/oauth/microsoft-dataverse'
import {
  assertMicrosoftDataverseWebOAuthAvailable,
  buildMicrosoftDataverseOAuthLinkRequest,
  useConnectMicrosoftDataverseOAuthService,
  useMicrosoftDataverseCredentialBinding,
} from '@/hooks/queries/oauth/microsoft-dataverse-connections'

function renderHookWithClient<T>(useHook: () => T): {
  queryClient: QueryClient
  result: () => T
  unmount: () => void
} {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  let latest: T

  function Probe() {
    latest = useHook()
    return null
  }

  act(() => {
    root.render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(Probe) as ReactNode)
    )
  })

  return {
    queryClient,
    result: () => latest,
    unmount: () => act(() => root.unmount()),
  }
}

describe('Microsoft Dataverse OAuth connections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBeginOAuthConnect.mockName('web')
    mockLink.mockResolvedValue({ data: {}, error: null })
  })

  it('builds the exact environment-bound Better Auth link request', () => {
    const request = buildMicrosoftDataverseOAuthLinkRequest({
      callbackURL: 'https://sim.test/workflow?existing=1',
      environmentUrl: ' https://contoso.crm4.dynamics.com/ ',
    })

    expect(request.providerId).toBe('microsoft-dataverse')
    expect(request.scopes).toEqual([
      'openid',
      'profile',
      'email',
      'https://contoso.api.crm4.dynamics.com/.default',
      'offline_access',
    ])
    expect(new URL(request.callbackURL).searchParams.get('__sim_dataverse_environment')).toBe(
      'https://contoso.api.crm4.dynamics.com'
    )
  })

  it('links in the web app and invalidates the shared connection cache', async () => {
    const hook = renderHookWithClient(useConnectMicrosoftDataverseOAuthService)
    const invalidate = vi.spyOn(hook.queryClient, 'invalidateQueries')

    await act(async () => {
      await hook.result().mutateAsync({
        callbackURL: 'https://sim.test/workflow',
        environmentUrl: 'https://contoso.crm.dynamics.com',
      })
    })

    expect(mockLink).toHaveBeenCalledWith({
      providerId: 'microsoft-dataverse',
      callbackURL:
        'https://sim.test/workflow?__sim_dataverse_environment=https%3A%2F%2Fcontoso.api.crm.dynamics.com',
      scopes: [
        'openid',
        'profile',
        'email',
        'https://contoso.api.crm.dynamics.com/.default',
        'offline_access',
      ],
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['oauthConnections', 'connections'] })
    hook.unmount()
  })

  it('rejects invalid environments and desktop initiation before linking', async () => {
    const webHook = renderHookWithClient(useConnectMicrosoftDataverseOAuthService)
    await expect(
      webHook.result().mutateAsync({
        callbackURL: 'https://sim.test/workflow',
        environmentUrl: 'https://evil.example',
      })
    ).rejects.toThrow('supported public-cloud Microsoft Dynamics host')
    webHook.unmount()

    mockBeginOAuthConnect.mockName('desktop')
    expect(() => assertMicrosoftDataverseWebOAuthAvailable()).toThrow('Sim web app')
    const desktopHook = renderHookWithClient(useConnectMicrosoftDataverseOAuthService)
    await expect(
      desktopHook.result().mutateAsync({
        callbackURL: 'https://sim.test/workflow',
        environmentUrl: 'https://contoso.crm.dynamics.com',
      })
    ).rejects.toThrow('Sim web app')
    expect(mockLink).not.toHaveBeenCalled()
    desktopHook.unmount()
  })

  it.each([
    ['not-dataverse', 'salesforce', [], false],
    ['legacy', 'microsoft-dataverse', ['https://dynamics.microsoft.com/user_impersonation'], false],
    [
      'bound',
      'microsoft-dataverse',
      [getMicrosoftDataverseRequiredScope('https://contoso.crm.dynamics.com')],
      false,
    ],
    [
      'invalid',
      'microsoft-dataverse',
      [
        getMicrosoftDataverseRequiredScope('https://contoso.crm.dynamics.com'),
        getMicrosoftDataverseRequiredScope('https://other.crm.dynamics.com'),
      ],
      false,
    ],
    ['loading', 'microsoft-dataverse', [], true],
  ])('classifies a stored credential as %s', (state, providerId, scopes, isPending) => {
    const hook = renderHookWithClient(() =>
      useMicrosoftDataverseCredentialBinding({ providerId, scopes, isPending })
    )

    expect(hook.result().state).toBe(state)
    if (state === 'bound') {
      expect(hook.result().environmentUrl).toBe('https://contoso.api.crm.dynamics.com')
    }
    hook.unmount()
  })
})
