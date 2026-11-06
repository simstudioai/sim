import 'server-only'
import type { Scenario } from '@/platform/fixtures'
import { integrationCatalog } from '@/platform/lib/integrations/catalog.generated'
import type { IntegrationCenterData } from '@/platform/lib/integrations/center-model'
import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'
import type {
  AccountMethod,
  IntegrationAccount,
  OrganizationIntegration,
} from '@/platform/lib/integrations/fixture-model'
import { gmailToolMetadata, providerMetadata } from '@/platform/lib/integrations/metadata.generated'

type Connection = Pick<OrganizationIntegration, 'availability' | 'connectableMethod'> & {
  account: IntegrationAccount | null
  accessDescription?: string
}

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
  account: IntegrationAccount | null = null,
  connectableMethod: AccountMethod | null = null
): Connection {
  return {
    account,
    connectableMethod,
    availability: 'ready',
  }
}

const full: Record<string, Connection> = {
  fireflies: ready(account('fireflies', 'Fireflies', 'mcp')),
  github: {
    ...ready(account('github', 'emir@sim.ai', 'oauth')),
    accessDescription: 'Selected repositories you can access',
  },
  gmail: ready(gmail),
  google_calendar: ready(account('calendar', 'emir@sim.ai', 'oauth')),
  google_drive: ready(account('drive', 'emir@sim.ai', 'oauth')),
  hubspot: ready(account('hubspot', 'HubSpot', 'mcp')),
  linear: ready(null, 'oauth'),
  notion: ready(null, 'mcp'),
  salesforce: ready({ ...account('crm', 'emir@sim.ai', 'oauth'), status: 'needs_reauth' }),
  slack: {
    ...ready(),
    availability: 'unconfigured',
    accessDescription: 'Slack sign-in has not been configured for this organization.',
  },
}

export function memberIntegrations(
  scenario: Scenario,
  center: IntegrationCenterData
): OrganizationIntegration[] {
  if (scenario === 'empty') return []
  const selected: Record<string, Connection> =
    scenario === 'full'
      ? full
      : {
          ...full,
          gmail: ready({
            ...gmail,
            permissions: {
              read: 'ask',
              write: 'ask',
              canAutoApprove: false,
              tools: gmail.permissions?.tools ?? [],
            },
          }),
          coda: ready(null, 'mcp'),
          jira: ready(null, 'oauth'),
          lucid: ready(null, 'mcp'),
          zoom: {
            ...ready(),
            availability: 'unavailable',
            accessDescription: 'Zoom is currently unavailable.',
          },
          confluence: {
            ...ready({
              ...account('confluence', 'engineering@sim.ai', 'oauth'),
              canReconnect: false,
            }),
            availability: 'disabled',
            accessDescription: 'Disabled by your organization',
          },
          google_meet: ready(null, 'oauth'),
          granola: {
            ...ready(),
            availability: 'paused',
            accessDescription: 'Connections are paused by your organization.',
          },
          gitlab: {
            ...ready(),
            availability: 'managed',
            accessDescription: 'Access follows project permissions',
          },
        }
  const searchIntegrations: OrganizationIntegration[] = providerMetadata.flatMap(
    ({ id, searchResource, ...metadata }) => {
      const config = selected[id]
      if (!config) return []
      return [
        {
          providerId: id,
          searchResource,
          ...metadata,
          availability: config.availability,
          connectableMethod: config.connectableMethod,
          credentials: credentialExamples(id, config.account, scenario, center),
          accessDescription:
            config.accessDescription ??
            (searchResource
              ? `All accessible ${searchResource === 'CRM records' ? searchResource : searchResource.toLowerCase()}`
              : 'Access follows your account permissions'),
          fixtureAuthorization: true,
          canAddCredential: true,
          credentialProviders: [],
        },
      ]
    }
  )
  const searchById = new Map(
    searchIntegrations.map((integration) => [integration.providerId, integration])
  )
  const catalogIds = new Set(integrationCatalog.map((integration) => integration.id))
  return [
    ...integrationCatalog.map((entry): OrganizationIntegration => {
      const existing = searchById.get(entry.id)
      const credentialProviders = [
        ...new Set(entry.connections.map(({ providerId }) => providerId)),
      ]
      if (existing) return { ...existing, category: entry.category, credentialProviders }
      return {
        providerId: entry.id,
        name: entry.name,
        description: entry.description,
        category: entry.category,
        setupGuideUrl: entry.docsUrl,
        searchResource: null,
        searchReads: [],
        requestedScopes: null,
        accessDescription: '',
        availability: 'catalog',
        fixtureAuthorization: true,
        canAddCredential: true,
        credentialProviders,
        connectableMethod: null,
        credentials: [],
      }
    }),
    ...searchIntegrations.filter((integration) => !catalogIds.has(integration.providerId)),
  ]
}

function credentialExamples(
  appId: string,
  account: IntegrationAccount | null,
  scenario: Scenario,
  { viewer, people }: IntegrationCenterData
): IntegrationCredential[] {
  const member = (id: string, role: 'admin' | 'member', inherited = false) => {
    const person = people.find((entry) => entry.id === id)
    if (!person) throw new Error('Credential example member is missing')
    return {
      ...person,
      userId: person.id,
      role,
      roleSource: inherited ? ('workspace-admin' as const) : ('explicit' as const),
      explicitAdmin: !inherited && role === 'admin',
      status: 'active' as const,
    }
  }
  const scope = {
    kind: 'workspace',
    id: 'customer-operations',
    name: 'Customer operations',
  } as const
  const credentials: IntegrationCredential[] = account
    ? [
        {
          id: account.id,
          appId,
          providerId:
            integrationCatalog
              .find((entry) => entry.id === appId)
              ?.connections.find((entry) => entry.kind === 'oauth')?.providerId ?? appId,
          type: account.method,
          displayName: account.label,
          description: appId === 'gmail' ? 'Customer conversations and account updates.' : '',
          accountLabel: account.label,
          role: 'admin',
          status: account.status,
          canReconnect: account.canReconnect,
          scope: account.method === 'oauth' ? scope : { kind: 'personal', ownerId: viewer.id },
          members: [member(viewer.id, 'admin')],
          permissions: account.permissions,
        },
      ]
    : []
  if (['gmail', 'google_calendar', 'google_drive'].includes(appId)) {
    credentials.push({
      id: 'google-team-service',
      appId: 'gmail',
      providerId: 'google-service-account',
      type: 'service_account',
      displayName: 'Customer operations service account',
      description: 'Shared automation for the customer operations team.',
      accountLabel: 'operations@customer-operations.iam.gserviceaccount.com',
      role: 'admin',
      status: 'active',
      canReconnect: true,
      scope,
      members: [
        member('nina', 'admin'),
        member(viewer.id, 'admin', true),
        member('alex', 'member'),
      ],
    })
  }
  if (scenario === 'stress' && appId === 'github') {
    credentials.push({
      id: 'github-engineering',
      appId,
      providerId: 'github-repo',
      type: 'oauth',
      displayName: 'Engineering repositories',
      description: 'Repository access shared by the engineering team.',
      role: 'member',
      status: 'active',
      canReconnect: false,
      scope: { kind: 'workspace', id: 'engineering', name: 'Engineering' },
      members: [member('alex', 'admin'), member(viewer.id, 'member')],
    })
  }
  if (scenario === 'stress' && appId === 'gitlab') {
    credentials.push({
      id: 'gitlab-personal',
      appId,
      providerId: 'gitlab',
      type: 'personal_token',
      displayName: 'My GitLab account',
      description: '',
      instanceUrl: 'https://gitlab.com',
      role: 'admin',
      status: 'active',
      canReconnect: true,
      scope: { kind: 'personal', ownerId: viewer.id },
      members: [member(viewer.id, 'admin')],
    })
  }
  if (scenario === 'stress' && appId === 'gitlab') {
    const organizationMembers = [
      member('nina', 'admin'),
      {
        ...member(viewer.id, 'admin'),
        roleSource: 'organization-admin' as const,
        explicitAdmin: false,
      },
      member('alex', 'member'),
      { ...member('daniel', 'member'), status: 'pending' as const },
    ]
    credentials.push(
      {
        id: 'gitlab-organization',
        appId,
        providerId: 'gitlab',
        type: 'oauth',
        displayName: 'Organization automations',
        description: 'Repository automation shared with selected organization members.',
        role: 'admin',
        status: 'active',
        canReconnect: false,
        scope: { kind: 'organization', id: 'sim', name: 'Sim Enterprise' },
        members: organizationMembers,
      },
      {
        id: 'gitlab-managed',
        appId,
        providerId: 'gitlab',
        type: 'oauth',
        displayName: 'Managed repositories',
        description: 'Organization-managed repository access.',
        role: 'member',
        status: 'active',
        canReconnect: false,
        scope: { kind: 'organization-managed', id: 'sim', name: 'Sim Enterprise' },
        members: organizationMembers.filter((entry) => entry.status === 'active'),
      }
    )
  }
  return credentials
}
