/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

import { listSsoProvidersContract, updateSsoProviderContract } from '@/lib/api/contracts/auth'
import { useSSOProviders, useUpdateSSOProvider } from '@/ee/sso/hooks/sso'

interface SsoProvidersResponse {
  providers: Array<{
    providerId: string
    domain: string
  }>
}

function createDeferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

const PROVIDERS_A: SsoProvidersResponse = {
  providers: [{ providerId: 'provider-a', domain: 'org-a.example.com' }],
}

let container: HTMLDivElement
let root: Root
let queryClient: QueryClient

function SsoProbe({ organizationId }: { organizationId: string }) {
  const providers = useSSOProviders({ organizationId })
  const provider = providers.data?.providers[0]

  return (
    <div>
      <span>{provider?.domain ?? ''}</span>
      {provider && <button type='button'>Edit SSO</button>}
    </div>
  )
}

function UpdateProbe() {
  const update = useUpdateSSOProvider()
  return (
    <button
      type='button'
      onClick={() =>
        update.mutate({
          id: 'row-1',
          organizationId: 'org-a',
          body: {
            issuer: 'https://idp.example.com',
            domain: 'org-a.example.com',
            mapping: { id: 'sub', email: 'email', name: 'name', image: 'picture' },
            clientId: 'client',
            clientSecret: 'secret',
            scopes: ['openid'],
            pkce: true,
          },
        })
      }
    >
      Update
    </button>
  )
}

function renderSso(organizationId: string) {
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <SsoProbe organizationId={organizationId} />
      </QueryClientProvider>
    )
  })
}

async function flushQueries() {
  await act(async () => {
    for (let index = 0; index < 5; index++) {
      await Promise.resolve()
      await sleep(0)
    }
  })
}

describe('useSSOProviders identity transitions', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    container.remove()
    vi.clearAllMocks()
  })

  it('clears org A provider data and edit actions while org B loads', async () => {
    const providersB = createDeferred<SsoProvidersResponse>()
    mockRequestJson.mockImplementation(
      (contract: unknown, input: { query?: { organizationId?: string } }) => {
        if (contract !== listSsoProvidersContract) throw new Error('Unexpected contract')
        return input.query?.organizationId === 'org-a'
          ? Promise.resolve(PROVIDERS_A)
          : providersB.promise
      }
    )

    renderSso('org-a')
    await flushQueries()

    expect(container).toHaveTextContent('org-a.example.com')
    expect(container.querySelector('button')).toHaveTextContent('Edit SSO')

    renderSso('org-b')
    await flushQueries()

    expect(container).not.toHaveTextContent('org-a.example.com')
    expect(container.querySelector('button')).toBeNull()
    expect(mockRequestJson).toHaveBeenCalledWith(
      listSsoProvidersContract,
      expect.objectContaining({ query: { organizationId: 'org-b' } })
    )
  })

  it('uses the PATCH contract and invalidates provider and organization caches', async () => {
    mockRequestJson.mockResolvedValue({
      success: true,
      providerId: 'provider-a',
      providerType: 'oidc',
      domainVerified: false,
      message: 'updated',
    })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <UpdateProbe />
        </QueryClientProvider>
      )
    })

    act(() => {
      container.querySelector('button')?.click()
    })
    await flushQueries()

    expect(mockRequestJson).toHaveBeenCalledWith(
      updateSsoProviderContract,
      expect.objectContaining({ params: { id: 'row-1' } })
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sso', 'providers'] })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['organizations', 'detail', 'org-a'],
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['organizations', 'list'] })
  })
})
