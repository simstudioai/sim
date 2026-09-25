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
