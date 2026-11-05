import 'server-only'
import type { Scenario } from '@/platform/fixtures'
import type {
  AccountMethod,
  IntegrationAccount,
  OrganizationIntegration,
} from '@/platform/lib/integrations/model'

type Connection = Omit<OrganizationIntegration, 'providerId' | 'name'>

function account(id: string, label: string, method: AccountMethod): IntegrationAccount {
  return { id, label, method, status: 'active', canReconnect: true }
}

const gmail = account('gmail-primary', 'emir@sim.ai', 'oauth')
gmail.permissions = {
  read: 'allow',
  write: 'ask',
  canAutoApprove: true,
  tools: [
    {
      id: 'gmail_list_labels_v2',
      label: 'Gmail List Labels',
      description: 'List labels in your mailbox.',
      kind: 'read',
      override: null,
    },
    {
      id: 'gmail_send_v2',
      label: 'Gmail Send',
      description: 'Send an email from this account.',
      kind: 'write',
      override: null,
    },
    {
      id: 'gmail_draft_v2',
      label: 'Gmail Draft',
      description: 'Create a draft in this mailbox.',
      kind: 'write',
      override: null,
    },
  ],
}

function ready(
  accounts: IntegrationAccount[],
  connectableMethod: AccountMethod | null = null
): Connection {
  return {
    accounts,
    connectableMethod,
    availability: 'ready',
    accessDescription: 'All accessible content',
  }
}

const full: Record<string, Connection> = {
  fireflies: ready([account('fireflies', 'Emir', 'mcp')]),
  github: {
    ...ready([account('github', 'emirkarabeg', 'oauth')]),
    accessDescription: 'Selected repositories you can access',
  },
  gmail: ready([gmail]),
  google_calendar: ready([account('calendar', 'emir@sim.ai', 'oauth')]),
  google_drive: ready([account('drive', 'emir@sim.ai', 'oauth')]),
  hubspot: ready([account('hubspot', 'Sim', 'mcp')]),
  linear: ready([], 'oauth'),
  notion: ready([], 'mcp'),
  salesforce: ready([{ ...account('crm', 'emir@sim.ai', 'oauth'), status: 'needs_reauth' }]),
  slack: {
    ...ready([]),
    availability: 'unconfigured',
    accessDescription: 'Slack sign-in has not been configured for this organization.',
  },
}

export function memberIntegrations(
  scenario: Scenario,
  providers: readonly { id: string; name: string }[]
): OrganizationIntegration[] {
  if (scenario === 'empty') return []
  const selected: Record<string, Connection> =
    scenario === 'full'
      ? full
      : {
          ...full,
          gmail: ready([
            gmail,
            {
              ...account('gmail-secondary', 'Customer operations and research', 'oauth'),
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
            ...ready([{ ...account('confluence', 'Engineering', 'oauth'), canReconnect: false }]),
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
  return providers.flatMap(({ id, name }) => {
    const config = selected[id]
    if (!config) return []
    const candidate = config.connectableMethod
      ? account(`${id}-available`, 'emir@sim.ai', config.connectableMethod)
      : undefined
    return [
      {
        providerId: id,
        name,
        ...config,
        connectionCandidate: candidate,
        fixtureAuthorization: true,
      },
    ]
  })
}
