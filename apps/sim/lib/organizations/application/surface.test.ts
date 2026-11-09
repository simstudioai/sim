/**
 * The surface read decides which organization a shell renders. Failure modes: a URL naming an
 * organization the viewer does not belong to rendering one they do, and a URL naming one of the
 * viewer's organizations rendering their landing organization instead.
 */
import { member } from '@sim/db/schema'
import { dbChainMockFns, hasMockCondition, queueTableRows, resetDbChainMock } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrganizationMembershipNotFoundError } from '@/lib/core/application/organization-authorization'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'

vi.mock('@/lib/organizations/surface', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/organizations/surface')>()),
  getOrganizationSurfaceContext: vi.fn(async (organizationId: string) => context(organizationId)),
}))
vi.mock('@/lib/organizations/surface-flags', () => ({
  resolveOrganizationSurfaceFlags: vi.fn(async () => ({ flags: {}, benchmarkEnabled: false })),
}))
vi.mock('@/lib/people/feature-flag', () => ({ canBrowsePeople: vi.fn(async () => false) }))
vi.mock('@/lib/sim-links/feature-flag', () => ({ isSimLinksEnabled: vi.fn(async () => false) }))
vi.mock('@/lib/permissions/super-user', () => ({ isPlatformAdmin: vi.fn(async () => false) }))
vi.mock('@/lib/platform/rollout', () => ({ isPlatformOrgUiEnabled: vi.fn(async () => true) }))

import { readOrganizationSurface } from '@/lib/organizations/application/surface'

/** The viewer joined org-a first, then org-b; org-c is someone else's. */
const VIEWER_ORGANIZATIONS = ['org-a', 'org-b']
const ALL_ORGANIZATIONS = [...VIEWER_ORGANIZATIONS, 'org-c']

function context(organizationId: string): OrganizationSurfaceContext {
  return {
    organization: { id: organizationId, name: organizationId, slug: organizationId, logo: null },
    viewer: { isAdmin: false },
    settingsFeatures: {
      billingEnabled: false,
      hasEnterprisePlan: false,
      governanceActive: false,
      hosted: false,
      selfHosted: {},
    },
    searchAccess: { memberScoped: false, sourceMirrored: false },
    connectedAccountsAvailable: false,
    // double-cast-allowed: the surface passes the rest of the context through unread
  } as unknown as OrganizationSurfaceContext
}

const principal = createSessionPrincipal({ userId: 'viewer' })

beforeEach(() => {
  resetDbChainMock()
  queueTableRows(
    member,
    VIEWER_ORGANIZATIONS.map((organizationId) => ({ organizationId }))
  )
  const landingQuery = dbChainMockFns.where.getMockImplementation()
  if (!landingQuery) throw new Error('Expected the default where implementation')
  dbChainMockFns.where.mockImplementation((condition: unknown) => {
    const named = ALL_ORGANIZATIONS.find((id) =>
      hasMockCondition(condition, (node) => node.type === 'eq' && node.right === id)
    )
    if (!named) return landingQuery(condition)
    const rows = VIEWER_ORGANIZATIONS.includes(named) ? [{ role: 'member' }] : []
    return { limit: async () => rows } as never
  })
})

describe('readOrganizationSurface', () => {
  it('refuses an organization the viewer does not belong to', async () => {
    await expect(
      readOrganizationSurface.execute({ principal, input: { organizationId: 'org-c' } })
    ).rejects.toBeInstanceOf(OrganizationMembershipNotFoundError)
  })

  it('reads the organization the caller names over the landing one', async () => {
    const surface = await readOrganizationSurface.execute({
      principal,
      input: { organizationId: 'org-b' },
    })
    expect(surface.organization.id).toBe('org-b')
  })
})
