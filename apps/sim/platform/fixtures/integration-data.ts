import 'server-only'
import type { Scenario } from '@/platform/fixtures'
import type {
  IntegrationAccount,
  IntegrationProvider,
  IntegrationsData,
  OrganizationIntegration,
} from '@/platform/lib/integrations/model'

function account(
  id: string,
  method: IntegrationAccount['method'],
  label: string
): IntegrationAccount {
  return { id, method, label, status: 'active' }
}

function integration(
  providerId: string,
  config: Partial<OrganizationIntegration>
): OrganizationIntegration {
  return {
    providerId,
    label: '',
    required: false,
    accountMethods: [],
    accounts: [],
    people: [],
    searchApproved: false,
    searchMode: null,
    sources: [],
    sourceId: null,
    ...config,
  }
}

const full: OrganizationIntegration[] = [
  integration('salesforce', {
    accountMethods: ['oauth'],
    accounts: [{ ...account('crm', 'oauth', 'emir@sim.ai'), status: 'needs_reauth' }],
  }),
  integration('github', {
    searchApproved: true,
    searchMode: 'service_account',
    sources: ['simstudioai/sim', 'simstudioai/docs'].map((repo) => ({
      id: repo,
      label: repo,
      mode: 'service_account',
      available: true,
      enabled: true,
      scope: [{ label: 'Repository', values: [repo] }],
    })),
    accountMethods: ['oauth'],
  }),
  integration('gmail', {
    searchApproved: true,
    searchMode: 'member',
    accountMethods: ['oauth'],
    accounts: [
      {
        ...account('mail', 'oauth', 'emir@sim.ai'),
        permissions: {
          read: 'allow',
          write: 'ask',
          canAutoApprove: true,
          tools: [
            { id: 'gmail_read', label: 'Read email', kind: 'read', override: null },
            { id: 'gmail_send', label: 'Send email', kind: 'write', override: null },
          ],
        },
      },
    ],
    people: [
      { id: 'nina', email: 'nina@example.com', status: 'completed' },
      { id: 'alex', email: 'alex@example.com', status: 'invited' },
      { id: 'maya', email: 'maya@example.com', status: 'delivery_failed' },
    ],
  }),
  integration('google_drive', {
    searchApproved: true,
    searchMode: 'service_account',
    sourceId: 'team-drive',
    accountMethods: ['oauth'],
    sources: [
      {
        id: 'team-drive',
        label: 'Team shared drive',
        mode: 'service_account',
        available: true,
        enabled: true,
        scope: [{ label: 'Folders', values: ['Product handbook'] }],
      },
    ],
  }),
  integration('slack', {
    searchApproved: true,
    searchMode: 'member',
    accountMethods: ['slack'],
    label: 'Sim team',
    required: true,
    slackStatus: 'ready',
    slackTeam: 'Sim team',
    accounts: [account('team', 'slack', 'Sim team')],
    people: [{ id: 'nina', email: 'nina@example.com', status: 'completed' }],
  }),
  integration('linear', { searchApproved: true, searchMode: 'member', accountMethods: ['oauth'] }),
  integration('notion', {
    searchApproved: true,
    searchMode: 'member',
    accountMethods: ['mcp'],
    accounts: [account('notion', 'mcp', 'Sim teamspace')],
  }),
  integration('outlook', {
    accountMethods: ['oauth'],
    accounts: [account('outlook', 'oauth', 'Operations mailbox')],
  }),
]

const credentialIds: Record<string, string> = {
  google_drive: 'google-drive',
  google_calendar: 'google-calendar',
  google_meet: 'google-meet',
  github: 'github-repositories',
}

export function integrationScenario(
  scenario: Scenario,
  providers: IntegrationProvider[],
  workspaces: IntegrationsData['workspaces']
): IntegrationsData {
  const integrations = scenario === 'empty' ? [] : [...full]
  if (scenario === 'stress') {
    for (const provider of providers) {
      if (integrations.some((item) => item.providerId === provider.id)) continue
      const searchMode = provider.searchModes[0] ?? null
      integrations.push(
        integration(provider.id, {
          accountMethods: [...provider.accountMethods],
          searchMode,
          searchApproved: Boolean(searchMode),
        })
      )
    }
  }
  const credentialTypes = providers.flatMap((provider) =>
    provider.accountMethods.map((method) => {
      const protocol = method === 'mcp' || method === 'databricks' ? 'mcp' : 'oauth'
      const id = protocol === 'oauth' ? (credentialIds[provider.id] ?? provider.id) : provider.id
      return {
        id: `${protocol}:${id}`,
        label:
          provider.accountMethods.length > 1
            ? `${provider.name} (${protocol === 'mcp' ? 'MCP' : 'OAuth'})`
            : provider.name,
      }
    })
  )
  credentialTypes.push({ id: 'personal_token:gitlab', label: 'GitLab' })
  return {
    canManage: true,
    providers,
    integrations,
    workspaces,
    credentialTypes,
    workspaceGrants: {
      ...(workspaces[0] && {
        [workspaces[0].id]: {
          mode: 'selected' as const,
          credentialTypes: ['oauth:gmail', 'oauth:slack'],
        },
      }),
      ...(workspaces[1] && { [workspaces[1].id]: { mode: 'all' as const } }),
    },
  }
}
