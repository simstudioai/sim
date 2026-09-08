/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ consent: vi.fn(), signOut: vi.fn() }))

vi.mock('@/lib/auth/auth-client', () => ({
  client: { oauth2: { consent: mocks.consent }, signOut: mocks.signOut },
}))

import { OAuthConsentView } from '@/app/(auth)/oauth/consent/consent-view'
import { oauthProviderKeys } from '@/hooks/queries/oauth-provider'

let root: Root
let container: HTMLDivElement
let queryClient: QueryClient

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (element) => element.textContent === label
  )
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}

async function click(label: string) {
  await act(async () => {
    button(label).click()
    await vi.advanceTimersByTimeAsync(1)
  })
}

describe('OAuth consent view', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(oauthProviderKeys.client('sim-cli', 'request'), {
      clientId: 'sim-cli',
      name: 'Sim CLI',
    })
    container = document.createElement('div')
    root = createRoot(container)
    act(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <OAuthConsentView
            refusal={null}
            clientId='sim-cli'
            authorizationRequestKey='request'
            scope='offline_access api:read api:write'
            redirectUri='http://127.0.0.1:1234/callback'
            email='test@example.com'
          />
        </QueryClientProvider>
      )
    )
  })

  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    vi.useRealTimers()
  })

  it('shows the account below the decisions without a CLI destination sentence', () => {
    expect(container.querySelector('h1')?.textContent).toBe('Authorize Sim CLI')
    expect(container.textContent).toContain('Continuing as test@example.com.')
    expect(container.textContent).not.toContain('Returns to this computer.')
    expect(
      Array.from(container.querySelectorAll('button')).map((element) => element.textContent)
    ).toEqual(['Allow', 'Deny', 'Use another account'])
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(button('Allow').disabled).toBe(false)
    expect(button('Deny').disabled).toBe(false)
  })

  it('keeps every decision disabled while consent is in flight', async () => {
    mocks.consent.mockReturnValue(new Promise(() => {}))
    await click('Allow')
    expect(mocks.consent).toHaveBeenCalledExactlyOnceWith({ accept: true })
    expect(
      Array.from(container.querySelectorAll('button')).every((element) => element.disabled)
    ).toBe(true)
    expect(container.textContent).toContain('Authorizing')
  })

  it('shows protocol errors and allows retrying the decision', async () => {
    mocks.consent.mockResolvedValue({ error: { message: 'The request has expired.' } })
    await click('Allow')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('The request has expired.')
    expect(button('Allow').disabled).toBe(false)
    expect(button('Use another account').disabled).toBe(false)
  })

  it('does not allow consent during sign-out and surfaces a failure under the original account', async () => {
    let finish: (value: { error: { message: string } }) => void = () => {}
    mocks.signOut.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    await click('Use another account')
    expect(button('Allow').disabled).toBe(true)
    expect(button('Deny').disabled).toBe(true)
    expect(button('Signing out…').disabled).toBe(true)
    await act(async () => {
      finish({ error: { message: 'Unable to end this session.' } })
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Unable to end this session.'
    )
    expect(container.textContent).toContain('Continuing as test@example.com.')
    expect(button('Allow').disabled).toBe(false)
    expect(mocks.consent).not.toHaveBeenCalled()
  })
})
