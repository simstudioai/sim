/**
 * @vitest-environment node
 */
import type { ReactElement } from 'react'
import { setEnvFlags } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveLaunchProvider, mockGetSession } = vi.hoisted(() => ({
  mockResolveLaunchProvider: vi.fn(),
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))

vi.mock('@/lib/auth/sso/idp-initiated-login', () => ({
  resolveIdpInitiatedLoginProvider: mockResolveLaunchProvider,
}))
vi.mock('@/ee/sso/components/sso-launch', () => ({ SSOLaunch: () => null }))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))

import SSOLaunchPage from '@/app/(auth)/sso/launch/[providerId]/page'

function open(providerId: string, search: Record<string, string>) {
  return SSOLaunchPage({
    params: Promise.resolve({ providerId }),
    searchParams: Promise.resolve(search),
  }) as Promise<ReactElement<{ providerId: string }>>
}

describe('SSO launch page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isSsoEnabled: true })
    mockGetSession.mockResolvedValue(null)
  })

  it('sends someone already signed in to the app without signing in again', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    await expect(open('acme-okta', { iss: 'https://acme.okta.test' })).rejects.toThrow(
      'redirect:/home'
    )
    expect(mockResolveLaunchProvider).not.toHaveBeenCalled()
  })

  it("starts sign-in when the provider's own identity provider opened it", async () => {
    mockResolveLaunchProvider.mockResolvedValue('acme-okta')
    const page = await open('acme-okta', { iss: 'https://acme.okta.test' })
    expect(page.props.providerId).toBe('acme-okta')
    expect(mockResolveLaunchProvider).toHaveBeenCalledWith('acme-okta', 'https://acme.okta.test')
  })

  it("sends a visitor without the provider's issuer to its ordinary sign-in link", async () => {
    mockResolveLaunchProvider.mockResolvedValue(null)
    await expect(open('acme-okta', { iss: 'https://other.example.test' })).rejects.toThrow(
      'redirect:/sso?provider=acme-okta'
    )
    await expect(open('acme okta', {})).rejects.toThrow('redirect:/sso?provider=acme%20okta')
    expect(mockResolveLaunchProvider).toHaveBeenCalledTimes(1)
  })

  it('leaves SSO off when the deployment has not enabled it', async () => {
    setEnvFlags({ isSsoEnabled: false })
    await expect(open('acme-okta', { iss: 'https://acme.okta.test' })).rejects.toThrow(
      'redirect:/login'
    )
    expect(mockResolveLaunchProvider).not.toHaveBeenCalled()
  })
})
