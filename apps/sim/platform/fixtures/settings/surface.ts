import 'server-only'
import { FIXTURE_ORGANIZATION_ID, FIXTURE_ROUTE_PREFIX, type Scenario } from '@/platform/fixtures'
import { settingsScenarios } from '@/platform/fixtures/settings-data'
import { shellScenarios } from '@/platform/fixtures/shell-data'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { previewSettingsSections } from '@/platform/lib/data/settings-navigation'
import type { PreviewPlan } from '@/platform/lib/navigation'

export function settingsSurface(scenario: Scenario, plan: PreviewPlan): PlatformOrganization {
  const { organization } = shellScenarios[scenario]
  const features = {
    accessControl: true,
    auditLogs: true,
    customBlocks: true,
    dataDrains: true,
    dataRetention: true,
    inbox: true,
    sandboxes: true,
    scim: true,
    sessionPolicies: true,
    sso: true,
    usageMonitoring: true,
    whitelabeling: true,
  }
  const enterprise = plan === 'enterprise'
  const platformAdmin = scenario === 'stress'
  const surface: Omit<PlatformOrganization, 'settingsSections'> = {
    organization: { ...organization, id: FIXTURE_ORGANIZATION_ID, slug: 'sim', logo: null },
    routePrefix: FIXTURE_ROUTE_PREFIX,
    viewer: {
      role: 'owner',
      isAdmin: true,
      canInviteMembers: true,
      canConnectSearchIntegrations: true,
      canUsePersonalApiKeys: true,
      canUseSearchMcp: true,
    },
    mothershipAvailable: true,
    searchAccess: { sourceMirrored: enterprise, memberScoped: enterprise },
    connectedAccountsAvailable: enterprise,
    settingsFeatures: {
      billingEnabled: true,
      hasEnterprisePlan: enterprise,
      governanceActive: enterprise,
      hosted: true,
      selfHosted: {},
      personal: false,
    },
    deployment: {
      hosted: true,
      billingEnabled: true,
      chatEnabled: true,
      azureConfigured: false,
      cohereConfigured: false,
      invitationsDisabled: false,
      features,
    },
    navFlags: {
      people: true,
      simLinks: true,
      benchmark: platformAdmin,
      platformAdmin,
      anonymous: false,
    },
    featureFlags: {
      dashboards: true,
      'workflow-tests': true,
      changelog: true,
      'mothership-model-selector': true,
      'mothership-computer-use': true,
      'mothership-plan-mode': platformAdmin,
      'mothership-memory-spaces': platformAdmin,
      projects: true,
    },
  }
  return { ...surface, settingsSections: previewSettingsSections(surface) }
}

export function settingsProfile(scenario: Scenario) {
  const { members, email } = settingsScenarios[scenario]
  return { id: members[0].id, name: shellScenarios[scenario].user.name, email, image: null }
}
