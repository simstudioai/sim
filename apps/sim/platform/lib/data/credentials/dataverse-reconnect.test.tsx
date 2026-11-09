/**
 * @vitest-environment jsdom
 *
 * Reconnecting a Dataverse credential must keep the environment it is bound to. Failure modes: a
 * bound credential reconnecting through the plain OAuth flow (losing its environment), an invalid
 * binding or an unreadable credential reconnecting anyway, and a non-Dataverse credential paying
 * for a lookup it does not need.
 */
import { act } from 'react'
import { flushMacrotask } from '@sim/testing/helpers/async'
import { authClientMock } from '@sim/testing/mocks/auth-client.mock'
import { libDesktopMock } from '@sim/testing/mocks/lib-desktop.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/client', () => authClientMock)
vi.mock('@/lib/desktop', () => libDesktopMock)

import { getMicrosoftDataverseRequiredScope } from '@/lib/oauth/microsoft-dataverse'
import { useDataverseReconnect } from '@/platform/lib/data/credentials/dataverse-reconnect'

const ENVIRONMENT = 'https://contoso.api.crm.dynamics.com'
const dataverse = { id: 'cred-1', type: 'oauth', providerId: 'microsoft-dataverse' }

let root: Root
let requests: string[]
let latest: ReturnType<typeof useDataverseReconnect> | undefined

function serve(response: () => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input))
      return response()
    })
  )
}

function credentialWithScopes(scopes: string[]) {
  return Response.json({
    credentials: [{ id: 'cred-1', name: 'Contoso', provider: 'microsoft-dataverse', scopes }],
  })
}

async function render(credential: typeof dataverse) {
  function Probe() {
    latest = useDataverseReconnect(credential)
    return null
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    )
  )
  await act(flushMacrotask)
  await act(flushMacrotask)
}

describe('reconnecting a Dataverse credential', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    requests = []
    latest = undefined
    root = createRoot(document.createElement('div'))
  })

  afterEach(() => {
    act(() => root.unmount())
    vi.unstubAllGlobals()
  })

  it('reconnects a bound credential to the environment it is bound to', async () => {
    serve(() => credentialWithScopes(['openid', getMicrosoftDataverseRequiredScope(ENVIRONMENT)]))
    await render(dataverse)
    expect(latest).toEqual({
      pending: false,
      blockedReason: undefined,
      environmentUrl: ENVIRONMENT,
    })
  })

  it('reconnects an unbound credential through the plain OAuth flow', async () => {
    serve(() => credentialWithScopes(['openid', 'offline_access']))
    await render(dataverse)
    expect(latest).toEqual({ pending: false, blockedReason: undefined, environmentUrl: undefined })
  })

  it('refuses an invalid binding instead of reconnecting it in place', async () => {
    serve(() =>
      credentialWithScopes([
        getMicrosoftDataverseRequiredScope(ENVIRONMENT),
        getMicrosoftDataverseRequiredScope('https://fabrikam.api.crm.dynamics.com'),
      ])
    )
    await render(dataverse)
    expect(latest?.blockedReason).toMatch(/invalid environment binding/)
    expect(latest?.environmentUrl).toBeUndefined()
  })

  it('refuses when the credential cannot be read', async () => {
    serve(() => Response.json({ error: 'Internal error' }, { status: 500 }))
    await render(dataverse)
    expect(latest?.blockedReason).toMatch(/Could not verify/)
  })

  it('reads nothing for a credential that is not Dataverse', async () => {
    serve(() => credentialWithScopes([]))
    await render({ id: 'cred-2', type: 'oauth', providerId: 'google-email' })
    expect(requests).toEqual([])
    expect(latest).toEqual({ pending: false, blockedReason: undefined, environmentUrl: undefined })
  })
})
