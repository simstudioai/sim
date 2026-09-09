/** @vitest-environment node */
import { authMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ context: vi.fn(), redirect: vi.fn() }))
vi.mock('@/lib/organizations/surface', () => ({ getOrganizationSurfaceContext: mocks.context }))
vi.mock('@/app/o/[organizationId]/integrations/integrations', () => ({
  OrganizationIntegrations: () => null,
}))
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  notFound: () => {
    throw new Error('Not found')
  },
}))

import OrganizationIntegrationsPage from '@/app/o/[organizationId]/integrations/page'

const token = '11111111-1111-4111-8111-111111111111'
const props = {
  params: Promise.resolve({ organizationId: 'organization-a' }),
  searchParams: Promise.resolve({ slack: token }),
}

beforeEach(() => {
  vi.clearAllMocks()
  authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'viewer' } })
  mocks.context.mockResolvedValue({ searchAccess: { memberScoped: true } })
  mocks.redirect.mockImplementation(() => {
    throw new Error('Redirect')
  })
})

describe('integrations page Slack context', () => {
  it('preserves the source page and Slack question context through login', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    await expect(OrganizationIntegrationsPage(props)).rejects.toThrow('Redirect')
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/login?callbackUrl=${encodeURIComponent(`/o/organization-a/integrations?slack=${token}`)}`
    )
    expect(mocks.context).not.toHaveBeenCalled()
  })

  it('uses the existing organization access check and current user for Slack actions', async () => {
    const page = await OrganizationIntegrationsPage(props)
    expect(mocks.context).toHaveBeenCalledWith('organization-a', 'viewer')
    expect(page.props.slackOnboarding).toEqual({ token, userId: 'viewer' })
    mocks.context.mockResolvedValueOnce(null)
    await expect(OrganizationIntegrationsPage(props)).rejects.toThrow('Not found')
  })

  it('leaves ordinary integrations visits free of Slack controls', async () => {
    const page = await OrganizationIntegrationsPage({ ...props, searchParams: Promise.resolve({}) })
    expect(page.props.slackOnboarding).toBeUndefined()
  })

  it('rejects malformed or repeated context tokens', async () => {
    for (const slack of ['bad-token', [token, token]]) {
      await expect(
        OrganizationIntegrationsPage({ ...props, searchParams: Promise.resolve({ slack }) })
      ).rejects.toThrow('Not found')
    }
    expect(mocks.context).not.toHaveBeenCalled()
  })
})
