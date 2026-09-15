/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSsoSignIn, mockReplace } = vi.hoisted(() => ({
  mockSsoSignIn: vi.fn(),
  mockReplace: vi.fn(),
}))

vi.mock('@/lib/auth/auth-client', () => ({ client: { signIn: { sso: mockSsoSignIn } } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mockReplace }) }))

import { SSOLaunch } from '@/ee/sso/components/sso-launch'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

async function launch() {
  await act(async () => root.render(<SSOLaunch providerId='acme-okta' />))
}

describe('SSOLaunch', () => {
  it('starts sign-in through the provider once, with no email', async () => {
    mockSsoSignIn.mockResolvedValue({ data: { url: 'https://idp.example.test' }, error: null })
    await launch()

    expect(host).toHaveTextContent('Redirecting to your identity provider')
    expect(mockSsoSignIn).toHaveBeenCalledTimes(1)
    const [signIn] = mockSsoSignIn.mock.calls[0]
    expect(signIn).not.toHaveProperty('email')
    expect(signIn.providerId).toBe('acme-okta')
    /** The SSO plugin appends `?error=…`, which must not corrupt the provider on the way back. */
    const back = new URL(`${signIn.errorCallbackURL}?error=invalid_provider`, 'https://sim.test')
    expect(back.pathname).toBe('/sso')
    expect(back.searchParams.get('provider')).toBe('acme-okta')
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it.each([
    ['refuses', () => mockSsoSignIn.mockResolvedValue({ data: null, error: { message: 'no' } })],
    ['throws', () => mockSsoSignIn.mockRejectedValue(new Error('network'))],
  ])("returns to the provider's sign-in link when sign-in %s", async (_label, arrange) => {
    arrange()
    await launch()

    expect(mockReplace).toHaveBeenCalledWith(
      '/sso?error=sso_failed&provider=acme-okta&callbackUrl=%2Fhome'
    )
  })
})
