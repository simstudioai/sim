/**
 * @vitest-environment jsdom
 *
 * The glue between the credential read and the Dataverse binding rules, which their own tests own.
 * Failure modes: a bound credential reconnecting through the plain OAuth flow (losing its
 * environment), and a non-Dataverse credential paying for a lookup it does not need.
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

  it('reads nothing for a credential that is not Dataverse', async () => {
    serve(() => credentialWithScopes([]))
    await render({ id: 'cred-2', type: 'oauth', providerId: 'google-email' })
    expect(requests).toEqual([])
    expect(latest).toEqual({ pending: false, blockedReason: undefined, environmentUrl: undefined })
  })
})
