/**
 * @vitest-environment node
 *
 * The shell renders whatever this read returns, so it must be the route's answer exactly. Failure
 * modes: a surface that has drifted from the route contract rendering as an organization, and a
 * viewer outside the organization rendering as a failed read instead of a denial.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrganizationSurfaceResponse } from '@/lib/api/contracts/organization'
import { getSession } from '@/lib/auth'
import { OrganizationMembershipNotFoundError } from '@/lib/core/application/organization-authorization'

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/organizations/application/surface', () => ({
  readOrganizationSurface: { execute },
}))

import { readOrganizationSurface } from '@/platform/lib/data/surface'

const SURFACE: OrganizationSurfaceResponse = {
  organization: { id: 'org-1', name: 'Acme', slug: 'acme', logo: null, memberCount: 3 },
  viewer: {
    role: 'member',
    isAdmin: false,
    canInviteMembers: false,
    canConnectSearchIntegrations: true,
    canUsePersonalApiKeys: true,
    canUseSearchMcp: true,
  },
  mothershipAvailable: true,
  canBuild: true,
  searchAccess: { sourceMirrored: false, memberScoped: true },
  connectedAccountsAvailable: true,
  settingsFeatures: {
    billingEnabled: false,
    hasEnterprisePlan: false,
    governanceActive: false,
    hosted: false,
    selfHosted: {},
    personal: false,
  },
  deployment: {
    hosted: false,
    billingEnabled: false,
    chatEnabled: true,
    azureConfigured: false,
    cohereConfigured: false,
    features: {
      accessControl: false,
      auditLogs: false,
      customBlocks: false,
      dataDrains: false,
      dataRetention: false,
      inbox: false,
      sandboxes: false,
      scim: false,
      sessionPolicies: false,
      sso: false,
      usageMonitoring: false,
      whitelabeling: false,
    },
  },
  navFlags: {
    people: true,
    simLinks: true,
    benchmark: false,
    platformAdmin: false,
    anonymous: false,
  },
  featureFlags: {
    dashboards: false,
    'workflow-tests': false,
    changelog: false,
    'mothership-model-selector': false,
    'mothership-computer-use': false,
    'mothership-plan-mode': false,
    'mothership-memory-spaces': false,
    projects: false,
  },
  settingsSections: ['account'],
}

/** Only the ids a principal carries are read from the session. */
const SESSION = { user: { id: 'viewer' }, session: { id: 'session-1' } } as NonNullable<
  Awaited<ReturnType<typeof getSession>>
>

beforeEach(() => {
  execute.mockReset()
  vi.mocked(getSession).mockResolvedValue(SESSION)
})

describe('readOrganizationSurface', () => {
  it('renders the use case surface, and refuses one that drifted from the route contract', async () => {
    execute.mockResolvedValueOnce(SURFACE)
    const read = await readOrganizationSurface('org-1')
    expect(read).toMatchObject({ status: 'ok', organization: SURFACE })
    expect(execute).toHaveBeenLastCalledWith({
      principal: { kind: 'session', userId: 'viewer', sessionId: 'session-1' },
      input: { organizationId: 'org-1' },
    })

    const { navFlags, ...drifted } = SURFACE
    execute.mockResolvedValueOnce(drifted)
    expect(await readOrganizationSurface('org-1')).toEqual({ status: 'unavailable' })
  })

  it("keeps a personal organization's kind through the contract, so its Settings stay personal", async () => {
    execute.mockResolvedValueOnce({
      ...SURFACE,
      settingsFeatures: { ...SURFACE.settingsFeatures, personal: true },
    })
    const read = await readOrganizationSurface('org-1')
    expect(read.status === 'ok' && read.organization.settingsFeatures.personal).toBe(true)
  })

  it('denies a viewer outside the named organization', async () => {
    execute.mockRejectedValueOnce(new OrganizationMembershipNotFoundError())
    expect(await readOrganizationSurface('org-2')).toEqual({ status: 'denied' })
  })
})
