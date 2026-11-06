import 'server-only'
import type {
  SearchSource,
  SourceConnection,
  SourceSettingsData,
} from '@/platform/app/(shell)/settings/_components/sections/integrations/model'
import { loadIntegrationsData, type Scenario } from '@/platform/fixtures'
import { searchSourceCatalog } from '@/platform/lib/integrations/source-catalog.generated'

/** An administrator's available inventory, after deployment and viewer gates. */
export async function sourceSettings(scenario: Scenario): Promise<SourceSettingsData> {
  const inventory = await loadIntegrationsData(scenario)
  const populated = scenario !== 'empty'
  const sources: SearchSource[] = searchSourceCatalog.map((provider) => ({
    ...provider,
    approved:
      populated && ['gmail', 'google_drive', 'github', 'gitlab', 'slack'].includes(provider.id),
    mode: provider.id === 'gitlab' || provider.id === 'github' ? 'service_account' : 'member',
  }))
  const connections: SourceConnection[] = populated
    ? [
        {
          id: 'repository',
          provider: 'github',
          name: 'simstudioai/sim',
          paused: false,
          fields: { repository: 'simstudioai/sim' },
        },
        {
          id: 'project',
          provider: 'gitlab',
          name: 'Engineering / Platform',
          paused: false,
          fields: { project: 'engineering/platform' },
        },
      ]
    : []
  return {
    assistantApps: (inventory?.integrations ?? [])
      .filter((entry) => entry.searchResource === null && entry.availability !== 'catalog')
      .map((entry) => ({
        id: entry.providerId,
        name: entry.name,
        account: entry.credentials[0]?.accountLabel ?? null,
        approved: entry.availability !== 'unconfigured',
      })),
    sources,
    connections,
    secrets: populated ? ['SERVICE_ENDPOINT', 'SERVICE_KEY'] : [],
    secretMode: populated ? 'organization' : null,
    slackApp: scenario === 'stress' ? 'Sim' : null,
  }
}
