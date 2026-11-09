import 'server-only'
import type { AttachmentItem } from '@sim/emcn/attachments/tile'
import type { PropertyItem } from '@sim/emcn/property-list'
import type { RecentItem } from '@sim/emcn-platform/recent-items'
import type { IntegrationsData } from '@/platform/lib/integrations/fixture-model'
import type { PreviewPlan } from '@/platform/lib/navigation'

export type Scenario = 'empty' | 'full' | 'stress'

/** The example organization's id. */
export const FIXTURE_ORGANIZATION_ID = 'sim'

/** The example organization's `routePrefix`: its routes live under `/o/sim`. */
export const FIXTURE_ROUTE_PREFIX = `/o/${FIXTURE_ORGANIZATION_ID}`

export interface PreviewData {
  collections: {
    recent: RecentItem[]
    attachments: AttachmentItem[]
    steps: { id: string; description: string }[]
  }
  dashboard: {
    destinations: string[]
    metrics: { label: string; value: string }[]
    rows: { id: string; values: Partial<Record<string, string | number | null>> }[]
  }
  samples: {
    labels: string[]
    captions: string[]
    properties: PropertyItem[]
    avatarSrc?: string
    media?: { src: string; label: string }
    recipients: { address: string; invalid?: boolean }[]
    ranges: string[]
    actions: string[]
    notes: string
  }
  charts: {
    maximum?: number
    trend: { date: string; value: number }[]
    bars: { label: string; values: [number, number] }[]
    distribution: { label: string; value: number }[]
  }
  specimen: Readonly<Record<string, string>>
  organization: {
    name: string
    members: string[]
    permissionGroups: string[]
    workspaces: { id: string; name: string; chats: string[] }[]
  }
}

/** Only invoke the scenario's import on a server that opted into preview data. */
function fixture<T, Args extends unknown[]>(
  read: (scenario: Scenario, ...args: Args) => Promise<T>
) {
  return (scenario: Scenario, ...args: Args): Promise<T | null> =>
    process.env.SIM_PLATFORM_FIXTURES === '1' ? read(scenario, ...args) : Promise.resolve(null)
}

export const loadPreviewData = fixture(
  async (scenario) => (await import('@/platform/fixtures/data')).scenarios[scenario]
)
export const loadShellData = fixture(async (scenario) => {
  const [{ shellScenarios }, { conversationScenarios }] = await Promise.all([
    import('@/platform/fixtures/shell-data'),
    import('@/platform/fixtures/conversation-data'),
  ])
  const { chat } = conversationScenarios[scenario]
  const { settingsSurface } = await import('@/platform/fixtures/settings/surface')
  const { resolveSettingsNavigation } = await import('@/platform/lib/data/settings-navigation')
  return {
    ...shellScenarios[scenario],
    settingsByPlan: {
      enterprise: resolveSettingsNavigation(settingsSurface(scenario, 'enterprise')),
      team: resolveSettingsNavigation(settingsSurface(scenario, 'team')),
      free: resolveSettingsNavigation(settingsSurface(scenario, 'free')),
    },
    chats: chat.threads.map(({ id, title }) => ({ id, title })),
  }
})
/** A shared layout stays mounted when the fixture query changes on the client. */
export async function loadShellScenarios() {
  const [empty, full, stress] = await Promise.all([
    loadShellData('empty'),
    loadShellData('full'),
    loadShellData('stress'),
  ])
  return empty && full && stress ? { empty, full, stress } : null
}

export const loadSettingsFixture = fixture(async (scenario, plan: PreviewPlan) => {
  const [{ settingsSurface, settingsProfile }, { BrowserSettings }, { FIXTURE_NOW }] =
    await Promise.all([
      import('@/platform/fixtures/settings/surface'),
      import('@/platform/fixtures/settings/browser'),
      import('@/platform/fixtures/clock'),
    ])
  return {
    organization: settingsSurface(scenario, plan),
    plan,
    scenario,
    profile: settingsProfile(scenario),
    referenceTime: FIXTURE_NOW,
    Provider: BrowserSettings,
  }
})
export const loadCredentialGroupsData = fixture(async (scenario) =>
  (await import('@/platform/fixtures/credential-groups-data')).credentialGroupsData(scenario)
)

export const loadConversationData = fixture(async (scenario) => {
  const [
    { conversationScenarios },
    { composerInventory, composerSkills },
    { shellScenarios },
    { panelScenarios },
    { integrationCatalog },
    { credentialGroupsData },
  ] = await Promise.all([
    import('@/platform/fixtures/conversation-data'),
    import('@/platform/fixtures/composer-data'),
    import('@/platform/fixtures/shell-data'),
    import('@/platform/fixtures/panel-data'),
    import('@/platform/lib/integrations/catalog.generated'),
    import('@/platform/fixtures/credential-groups-data'),
  ])
  const { home, chat, referenceFiles } = conversationScenarios[scenario]
  const inventory = composerInventory({
    threads: chat.threads,
    files: referenceFiles,
    workspaces: shellScenarios[scenario].workspaces,
    providers: scenario === 'empty' ? [] : integrationCatalog,
    skills: composerSkills(scenario),
    credentials: credentialGroupsData(scenario),
    desktopPage: panelScenarios[scenario]?.website?.name,
  })
  return {
    home: { ...home, composerInventory: inventory },
    chat: { ...chat, composerInventory: inventory },
  }
})
export const loadIntegrationsData = fixture(
  async (scenario, secrets?: string | string[]): Promise<IntegrationsData> => {
    const [{ memberIntegrations }, { memberSecretSource }, { integrationCenterData }] =
      await Promise.all([
        import('@/platform/fixtures/integration-data'),
        import('@/platform/fixtures/member-secret-source'),
        import('@/platform/fixtures/integration-center-data'),
      ])
    return {
      integrations: memberIntegrations(scenario, integrationCenterData(scenario)),
      genericSecrets: memberSecretSource(scenario, secrets),
    }
  }
)
export const loadIntegrationCenterData = fixture(async (scenario) =>
  (await import('@/platform/fixtures/integration-center-data')).integrationCenterData(scenario)
)
export const loadIntegrationCatalogEntry = fixture(async (scenario, providerId?: string) => {
  if (scenario === 'empty' || !providerId) return null
  const { integrationCatalog } = await import('@/platform/lib/integrations/catalog.generated')
  return integrationCatalog.find((entry) => entry.id === providerId) ?? null
})
export const loadPanelData = fixture(
  async (scenario) => (await import('@/platform/fixtures/panel-data')).panelScenarios[scenario]
)

export async function loadHomeRecentLinks(scenario: Scenario): Promise<RecentItem[]> {
  const panel = await loadPanelData(scenario)
  return (panel?.recents ?? []).flatMap(({ id, label, icon, destination, address }) =>
    destination === 'website' && address ? [{ id, label, icon, href: `https://${address}` }] : []
  )
}

export const loadSourceSettings = fixture(async (scenario) =>
  (await import('@/platform/fixtures/settings-sources-data')).sourceSettings(scenario)
)

export const loadSlackSettings = fixture(async (scenario) =>
  (await import('@/platform/fixtures/search-slack-data')).slackSettings(scenario)
)
export const loadAdminExample = fixture(async (scenario) =>
  (await import('@/platform/fixtures/settings/admin')).adminExample(scenario)
)

/**
 * The shell's workspace, so example names and workflows match the sidebar. The empty scenario lists
 * no workspaces, so its pages borrow the full scenario's identities and show every empty state.
 */
async function shellWorkspace(scenario: Scenario, workspaceId: string) {
  const { shellScenarios } = await import('@/platform/fixtures/shell-data')
  return shellScenarios[scenario === 'empty' ? 'full' : scenario].workspaces.find(
    (item) => item.id === workspaceId
  )
}

/** A workspace's heading, for a tab that has no example data of its own. */
export const loadWorkspaceSummary = fixture(async (scenario, workspaceId: string) => {
  const workspace = await shellWorkspace(scenario, workspaceId)
  if (!workspace) return null
  return (await import('@/platform/fixtures/workspace-data')).workspaceSummary(scenario, workspace)
})
export const loadWorkspaceDashboard = fixture(async (scenario, workspaceId: string) => {
  const workspace = await shellWorkspace(scenario, workspaceId)
  if (!workspace) return null
  return (await import('@/platform/fixtures/workspace-data')).workspaceDashboard(
    scenario,
    workspace
  )
})
export const loadWorkspaceIssues = fixture(async (scenario, workspaceId: string) => {
  const workspace = await shellWorkspace(scenario, workspaceId)
  if (!workspace) return null
  return (await import('@/platform/fixtures/workspace-data')).workspaceIssues(scenario, workspace)
})
export const loadWorkspaceIssue = fixture(
  async (scenario, workspaceId: string, issueId: string) => {
    const workspace = await shellWorkspace(scenario, workspaceId)
    if (!workspace) return null
    return (await import('@/platform/fixtures/workspace-data')).workspaceIssue(
      scenario,
      workspace,
      issueId
    )
  }
)
export const loadWorkspaceChangelog = fixture(async (scenario, workspaceId: string) => {
  const workspace = await shellWorkspace(scenario, workspaceId)
  if (!workspace) return null
  return (await import('@/platform/fixtures/workspace-data')).workspaceChangelog(
    scenario,
    workspace
  )
})
export const loadWorkspaceChangelogEntry = fixture(
  async (scenario, workspaceId: string, entryId: string) => {
    const workspace = await shellWorkspace(scenario, workspaceId)
    if (!workspace) return null
    return (await import('@/platform/fixtures/workspace-data')).workspaceChangelogEntry(
      scenario,
      workspace,
      entryId
    )
  }
)
export const loadWorkspaceRuns = fixture(async (scenario, workspaceId: string) => {
  const workspace = await shellWorkspace(scenario, workspaceId)
  if (!workspace) return null
  return (await import('@/platform/fixtures/workspace-data')).workspaceRuns(scenario, workspace)
})
export const loadWorkspaceRun = fixture(async (scenario, workspaceId: string, runId: string) => {
  const workspace = await shellWorkspace(scenario, workspaceId)
  if (!workspace) return null
  return (await import('@/platform/fixtures/workspace-data')).workspaceRun(
    scenario,
    workspace,
    runId
  )
})
