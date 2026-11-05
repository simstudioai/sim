import 'server-only'
import type { AttachmentItem } from '@/platform/design-system/components/attachments/attachment-tile'
import type { PropertyItem } from '@/platform/design-system/components/property-list/property-list'
import type { RecentItem } from '@/platform/design-system/components/recent-items/recent-items'
import type { IntegrationsData } from '@/platform/lib/integrations/model'

export type Scenario = 'empty' | 'full' | 'stress'

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
  return {
    ...shellScenarios[scenario],
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

export const loadSettingsData = fixture(
  async (scenario) =>
    (await import('@/platform/fixtures/settings-data')).settingsScenarios[scenario]
)
export const loadConversationData = fixture(
  async (scenario) =>
    (await import('@/platform/fixtures/conversation-data')).conversationScenarios[scenario]
)
export const loadIntegrationsData = fixture(
  async (scenario, secrets?: string | string[]): Promise<IntegrationsData> => {
    const [{ memberIntegrations }, { integrationProviders }, { memberSecretSource }] =
      await Promise.all([
        import('@/platform/fixtures/integration-data'),
        import('@/platform/fixtures/integration-providers'),
        import('@/platform/fixtures/member-secret-source'),
      ])
    return {
      integrations: memberIntegrations(scenario, integrationProviders),
      genericSecrets: memberSecretSource(scenario, secrets),
    }
  }
)
export const loadPanelData = fixture(
  async (scenario) => (await import('@/platform/fixtures/panel-data')).panelScenarios[scenario]
)

export async function loadHomeRecentLinks(scenario: Scenario): Promise<RecentItem[]> {
  const panel = await loadPanelData(scenario)
  return (panel?.recents ?? []).flatMap(({ id, label, icon, destination, address }) =>
    destination === 'website' && address ? [{ id, label, icon, href: `https://${address}` }] : []
  )
}
