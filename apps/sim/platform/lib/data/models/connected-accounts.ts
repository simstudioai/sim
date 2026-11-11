import type { LoadMoreState } from '@sim/emcn/scroll-area/use-load-more'
import type { ContractJsonResponse } from '@/lib/api/contracts'
import type { listOrganizationAccountPeopleContract } from '@/lib/api/contracts/organization-accounts'
import { ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT } from '@/lib/credential-groups/limits'
import type { WorkspaceGrant } from '@/platform/lib/data/credential-group-actions'
import { credentialGroupCatalog } from '@/platform/lib/integrations/metadata.generated'

export interface CredentialProvider {
  key: string
  provider: string
  name: string
  method: 'oauth' | 'mcp'
}

/** The brand icon a provider draws with: GitHub repositories are GitHub's. */
export function credentialProviderIconId({ provider }: CredentialProvider): string {
  return provider === 'github-repositories' ? 'github' : provider.replaceAll('-', '_')
}

/** The most workspaces one account pool can grant access to. */
export const MAX_WORKSPACE_GRANTS = ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT

export interface DatabricksConfiguration {
  name: string
  url: string
  clientId: string
  hasSecret: boolean
}

export interface CredentialGroupPerson {
  id: string
  email: string
  revoked: boolean
  accounts: string[]
}

type PeopleEnrollment = ContractJsonResponse<
  typeof listOrganizationAccountPeopleContract
>['enrollments'][number]

/** One person asked to connect accounts, with the accounts they have connected. */
export function toCredentialGroupPerson(person: PeopleEnrollment): CredentialGroupPerson {
  return {
    id: person.id,
    email: person.email,
    revoked: person.status === 'revoked',
    accounts: [
      ...person.connections
        .filter((entry) => entry.status === 'active')
        .map(
          (entry) =>
            `${credentialGroupCatalog.find((item) => item.method === 'oauth' && item.provider === entry.provider)?.name ?? 'GitLab'}${entry.count > 1 ? ` · ${entry.count}` : ''}`
        ),
      ...person.mcpConnections
        .filter((entry) => entry.status === 'active')
        .map((entry) => entry.name),
    ],
  }
}

/** The People tab's rows as its source pages them: the example's whole roster, or the live pages. */
export interface CredentialGroupPeople {
  rows: CredentialGroupPerson[]
  /** The first page has not answered yet. */
  pending: boolean
  failure: { message: string; retry: () => void } | null
  /** Absent where every row is already here. */
  loadMore?: LoadMoreState
}

export interface CredentialGroupsData {
  slackTeams?: readonly string[]
  databricks?: DatabricksConfiguration
  setup: boolean
  canManage: boolean
  catalog: CredentialProvider[]
  configured: string[]
  workspaces: { id: string; name: string }[]
  grants: WorkspaceGrant[]
  credentialTypes: { value: string; label: string }[]
}

/** The example's data, which also holds its whole People roster. */
export interface CredentialGroupsFixture extends CredentialGroupsData {
  people: CredentialGroupPerson[]
}
