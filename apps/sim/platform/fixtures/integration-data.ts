import 'server-only'
import type { Scenario } from '@/platform/fixtures'
import { gmailToolMetadata, providerMetadata } from '@/platform/lib/integrations/metadata.generated'
import type {
  AccountMethod,
  IntegrationAccount,
  OrganizationIntegration,
} from '@/platform/lib/integrations/model'

type Connection = Omit<
  OrganizationIntegration,
  'providerId' | 'name' | 'description' | 'requestedScopes' | 'accessDescription'
> & { accessDescription?: string }

function account(id: string, label: string, method: AccountMethod): IntegrationAccount {
  return { id, label, method, status: 'active', canReconnect: true }
}

const gmail = account('gmail-primary', 'emir@sim.ai', 'oauth')
gmail.permissions = {
  read: 'allow',
  write: 'ask',
  canAutoApprove: true,
  tools: gmailToolMetadata.map((tool) => ({ ...tool, override: null })),
}

function ready(
  accounts: IntegrationAccount[],
  connectableMethod: AccountMethod | null = null
): Connection {
  return {
    accounts,
    connectableMethod,
    availability: 'ready',
  }
}

const full: Record<string, Connection> = {
  fireflies: ready([account('fireflies', 'Fireflies', 'mcp')]),
  github: {
    ...ready([account('github', 'emir@sim.ai', 'oauth')]),
    accessDescription: 'Selected repositories you can access',
  },
  gmail: ready([gmail]),
  google_calendar: ready([account('calendar', 'emir@sim.ai', 'oauth')]),
  google_drive: ready([account('drive', 'emir@sim.ai', 'oauth')]),
  hubspot: ready([account('hubspot', 'HubSpot', 'mcp')]),
  linear: ready([], 'oauth'),
  notion: ready([], 'mcp'),
  salesforce: ready([{ ...account('crm', 'emir@sim.ai', 'oauth'), status: 'needs_reauth' }]),
  slack: {
    ...ready([]),
    availability: 'unconfigured',
    accessDescription: 'Slack sign-in has not been configured for this organization.',
  },
}

export function memberIntegrations(scenario: Scenario): OrganizationIntegration[] {
  if (scenario === 'empty') return []
  const selected: Record<string, Connection> =
    scenario === 'full'
      ? full
      : {
          ...full,
          gmail: ready([
            {
              ...gmail,
              permissions: {
                read: 'ask',
                write: 'ask',
                canAutoApprove: false,
                tools: gmail.permissions?.tools ?? [],
              },
            },
          ]),
          coda: ready([], 'mcp'),
          jira: ready([], 'oauth'),
          lucid: ready([], 'mcp'),
          zoom: {
            ...ready([]),
            availability: 'unavailable',
            accessDescription: 'Zoom is currently unavailable.',
          },
          confluence: {
            ...ready([
              { ...account('confluence', 'engineering@sim.ai', 'oauth'), canReconnect: false },
            ]),
            availability: 'disabled',
            accessDescription: 'Disabled by your organization',
          },
          google_meet: ready([], 'oauth'),
          granola: {
            ...ready([]),
            availability: 'paused',
            accessDescription: 'Connections are paused by your organization.',
          },
          gitlab: {
            ...ready([]),
            availability: 'managed',
            accessDescription: 'Access follows project permissions',
          },
        }
  return providerMetadata.flatMap(({ id, name, description, requestedScopes, searchResource }) => {
    const config = selected[id]
    if (!config) return []
    const candidate = config.connectableMethod
      ? account(
          `${id}-available`,
          config.connectableMethod === 'mcp' ? name : 'emir@sim.ai',
          config.connectableMethod
        )
      : undefined
    return [
      {
        providerId: id,
        name,
        description,
        requestedScopes,
        ...config,
        accessDescription:
          config.accessDescription ??
          (searchResource
            ? `All accessible ${searchResource === 'CRM records' ? searchResource : searchResource.toLowerCase()}`
            : 'Access follows your account permissions'),
        connectionCandidate: candidate,
        fixtureAuthorization: true,
      },
    ]
  })
}
