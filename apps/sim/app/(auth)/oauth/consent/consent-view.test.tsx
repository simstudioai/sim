/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { AuthRoot } from '@sim/auth-ui'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/client', () => authClientMock)

import { OAuthConsentView } from '@/app/(auth)/oauth/consent/consent-view'
import { oauthProviderKeys } from '@/hooks/queries/oauth-provider'

const mocks = {
  consent: authClientMockFns.mockClient.oauth2.consent,
  signOut: authClientMockFns.mockSignOut,
}

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

function accountButton(): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')
  if (!found) throw new Error('Missing account menu')
  return found
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
    document.body.appendChild(container)
    root = createRoot(container)
    act(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthRoot>
            <OAuthConsentView
              refusal={null}
              clientId='sim-cli'
              authorizationRequestKey='request'
              scope='offline_access api:read api:write'
              redirectUri='http://127.0.0.1:1234/callback'
              email='test@example.com'
            />
          </AuthRoot>
        </QueryClientProvider>
      )
    )
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
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
    await act(async () => {
      accountButton().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await vi.advanceTimersByTimeAsync(20)
    })
    const switchAccount = container.querySelector<HTMLElement>('[role="menuitem"]')
    expect(switchAccount?.textContent).toBe('Use another account')
    await act(async () => {
      switchAccount?.click()
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(button('Allow').disabled).toBe(true)
    expect(button('Deny').disabled).toBe(true)
    expect(accountButton().disabled).toBe(true)
    expect(accountButton().textContent).toContain('Signing out…')
    await act(async () => {
      finish({ error: { message: 'Unable to end this session.' } })
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Unable to end this session.'
    )
    expect(accountButton().textContent).toContain('Signed in as')
    expect(accountButton().textContent).toContain('test@example.com')
    expect(button('Allow').disabled).toBe(false)
    expect(mocks.consent).not.toHaveBeenCalled()
  })
})
