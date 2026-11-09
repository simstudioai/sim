/**
 * @vitest-environment node
 *
 * Integrations is the only home of credential management and skill authoring. Failure modes: an
 * organization without Enterprise member access (most are personal) losing the Integrations entry
 * or being served the member-scoped page, whose reads refuse it; and the Enterprise-only pages
 * beneath Integrations (member secrets, per-account tool permissions) opening for it.
 */
import { describe, expect, it } from 'vitest'
import { resolveLiveDestinations } from '@/app/(product)/_components/destinations'
import { integrationsMode } from '@/platform/lib/data/integrations-mode'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'

interface Plan {
  memberScoped: boolean
  connectedAccountsAvailable: boolean
  canConnectSearchIntegrations?: boolean
  personal?: boolean
}

function organization({
  memberScoped,
  connectedAccountsAvailable,
  canConnectSearchIntegrations = true,
  personal = false,
}: Plan): PlatformOrganization {
  return {
    organization: { id: 'org-1', name: 'Org', slug: 'org', logo: null, memberCount: 1 },
    routePrefix: '/o/org-1',
    viewer: {
      role: 'owner',
      isAdmin: true,
      canInviteMembers: true,
      canConnectSearchIntegrations,
      canUsePersonalApiKeys: true,
      canUseSearchMcp: true,
    },
    mothershipAvailable: true,
    canBuild: true,
    searchAccess: { sourceMirrored: memberScoped, memberScoped },
    connectedAccountsAvailable,
    settingsFeatures: {
      billingEnabled: true,
      hasEnterprisePlan: memberScoped,
      governanceActive: memberScoped,
      hosted: true,
      selfHosted: {},
      personal,
    },
    deployment: {
      hosted: true,
      billingEnabled: true,
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
      people: false,
      simLinks: false,
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
    settingsSections: [],
  }
}

const navigation = (plan: Plan) => resolveLiveDestinations(organization(plan)).map(({ id }) => id)

describe('Integrations for every organization', () => {
  const personal = { memberScoped: false, connectedAccountsAvailable: false, personal: true }
  const enterprise = { memberScoped: true, connectedAccountsAvailable: true }

  it('lists Integrations for a personal organization, and keeps Search Enterprise-only', () => {
    expect(navigation(personal)).toContain('integrations')
    expect(navigation(personal)).not.toContain('search')
    expect(navigation(enterprise)).toEqual(expect.arrayContaining(['search', 'integrations']))
  })

  it('serves a personal organization workspace credentials and skills, not the member pages', () => {
    expect(integrationsMode(organization(personal))).toBe('workspace')
    expect(integrationsMode(organization(enterprise))).toBe('member')
  })

  it('serves workspace credentials wherever the member inventory would refuse the viewer', () => {
    expect(
      integrationsMode(organization({ ...enterprise, connectedAccountsAvailable: false }))
    ).toBe('workspace')
    expect(
      integrationsMode(organization({ ...enterprise, canConnectSearchIntegrations: false }))
    ).toBe('workspace')
  })
})
