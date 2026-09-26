import { authMockFns } from '@sim/testing'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ context: vi.fn() }))
vi.mock('@/lib/organizations/surface', () => ({ getOrganizationSurfaceContext: mocks.context }))
vi.mock('@/app/o/[organizationId]/integrations/integrations', () => ({
  OrganizationIntegrations: () => null,
}))
vi.mock('next/navigation', () => nextNavigationMock)

import OrganizationIntegrationsPage from '@/app/o/[organizationId]/integrations/page'

const mockRedirect = nextNavigationMockFns.mockRedirect

const token = '11111111-1111-4111-8111-111111111111'
const props = {
  params: Promise.resolve({ organizationId: 'organization-a' }),
  searchParams: Promise.resolve({ slack: token }),
}

beforeEach(() => {
  authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'viewer' } })
  mocks.context.mockResolvedValue({ searchAccess: { memberScoped: true } })
})

describe('integrations page Slack context', () => {
  it('preserves a requested connection across login and validates it in the existing organization page', async () => {
    const selected = {
      ...props,
      searchParams: Promise.resolve({
        connectorType: 'gmail',
        connectorId: 'source',
        credentialId: 'account',
      }),
    }
    const page = await OrganizationIntegrationsPage(selected)
    expect(page.props.connectionRequest).toMatchObject({
      userId: 'viewer',
      target: {
        type: 'link',
        connectorType: 'gmail',
        connectorId: 'source',
        credentialId: 'account',
      },
    })
    authMockFns.mockGetSession.mockResolvedValue(null)
    await expect(OrganizationIntegrationsPage(selected)).rejects.toThrow('NEXT_REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith(
      `/login?callbackUrl=${encodeURIComponent('/o/organization-a/integrations?connectorType=gmail&connectorId=source&credentialId=account')}`
    )
  })
  it('rejects unknown providers and reconnects without a source', async () => {
    for (const query of [
      { connectorType: 'invented' },
      { connectorType: 'gmail', credentialId: 'account' },
    ]) {
      await expect(
        OrganizationIntegrationsPage({ ...props, searchParams: Promise.resolve(query) })
      ).rejects.toThrow('NEXT_NOT_FOUND')
    }
  })
  it('preserves the source page and Slack question context through login', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    await expect(OrganizationIntegrationsPage(props)).rejects.toThrow('NEXT_REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith(
      `/login?callbackUrl=${encodeURIComponent(`/o/organization-a/integrations?slack=${token}`)}`
    )
    expect(mocks.context).not.toHaveBeenCalled()
  })

  it('uses the existing organization access check and current user for Slack actions', async () => {
    const page = await OrganizationIntegrationsPage(props)
    expect(mocks.context).toHaveBeenCalledWith('organization-a', 'viewer')
    expect(page.props.slackOnboarding).toEqual({ token, userId: 'viewer' })
    mocks.context.mockResolvedValueOnce(null)
    await expect(OrganizationIntegrationsPage(props)).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('leaves ordinary integrations visits free of Slack controls', async () => {
    const page = await OrganizationIntegrationsPage({ ...props, searchParams: Promise.resolve({}) })
    expect(page.props.slackOnboarding).toBeUndefined()
  })

  it('rejects malformed or repeated context tokens', async () => {
    for (const slack of ['bad-token', [token, token]]) {
      await expect(
        OrganizationIntegrationsPage({ ...props, searchParams: Promise.resolve({ slack }) })
      ).rejects.toThrow('NEXT_NOT_FOUND')
    }
    expect(mocks.context).not.toHaveBeenCalled()
  })
})

it('preserves a live Slack reconnect chip through navigation and login without an indexed source', async () => {
  const query = {
    connectorType: 'slack',
    connectionMode: 'live',
    optionId: 'slack-option',
    provider: 'slack',
    credentialId: 'own-account',
  }
  const selected = { ...props, searchParams: Promise.resolve(query) }
  const page = await OrganizationIntegrationsPage(selected)
  expect(page.props.connectionRequest).toEqual({
    userId: 'viewer',
    target: { type: 'link', ...query },
  })
  authMockFns.mockGetSession.mockResolvedValue(null)
  await expect(OrganizationIntegrationsPage(selected)).rejects.toThrow('NEXT_REDIRECT')
  const redirect = new URL(mockRedirect.mock.calls[0][0], 'https://sim.test')
  const callback = new URL(redirect.searchParams.get('callbackUrl')!, 'https://sim.test')
  for (const [key, value] of Object.entries(query))
    expect(callback.searchParams.get(key)).toBe(value)
})
