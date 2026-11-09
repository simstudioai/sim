import type { IntegrationCatalogEntry } from '@/platform/lib/integrations/catalog-model'
import type { CredentialConnection } from '@/platform/lib/integrations/credential-model'

/**
 * What the viewer may do with an app in one workspace, as the workspace's integration access policy
 * decides it: `available` connects, `unconfigured` is listed but this deployment cannot connect it,
 * and `restricted` is one the permission group withholds but the viewer may request access to. An
 * app the policy denies outright is not listed at all.
 */
type WorkspaceAppAccess = 'available' | 'unconfigured' | 'restricted'

/** One connection method the deployment can complete, in the catalog's projection. */
export type WorkspaceAppConnection = Pick<
  CredentialConnection,
  'id' | 'kind' | 'label' | 'providerId' | 'setup' | 'requiredScopes'
> & {
  /** The Atlassian product an Atlassian service account connects for this app. */
  atlassianProduct?: 'jira' | 'confluence'
}

/** Why an app the deployment has not configured cannot be connected. */
export const UNCONFIGURED_APP_REASON = 'Unavailable in this deployment. Contact your administrator.'

/** The connection that adds a GitLab personal access token, the one personal token form. */
export const GITLAB_TOKEN_CONNECTION = 'gitlab-personal-token'

/** Connection fields that hold the immutable host or environment a credential connects to. */
const INSTANCE_FIELDS: ReadonlySet<string> = new Set(['domain', 'dataverseEnvironmentUrl'])

/** An app of a workspace's Integrations directory: catalog metadata and the viewer's verdict. */
export interface WorkspaceApp {
  id: string
  /** The block type the access policy judges and an access request names. */
  type: string
  /** The legacy workspace page's URL segment, which older links still name. */
  slug: string
  name: string
  description: string
  category: string
  docsUrl: string
  access: WorkspaceAppAccess
  /** Every provider id a credential for this app can carry, connectable here or not. */
  credentialProviders: readonly string[]
  /** The methods that can add a credential now; empty when none can. */
  connections: readonly WorkspaceAppConnection[]
  /** What each credential provider's immutable host or environment is called, by provider id. */
  instanceLabels: Readonly<Record<string, string>>
}

/** What the detail page adds for the one app it shows. */
export interface WorkspaceAppDetail extends WorkspaceApp {
  example: string
  /** Suggested skills a workspace can add for this app. */
  skills: IntegrationCatalogEntry['skills']
  /** Agent templates whose prompt opens in Chat. */
  templates: IntegrationCatalogEntry['templates']
}

/** The verdicts one catalog projection reads, already resolved for the viewer and workspace. */
export interface WorkspaceAppVerdicts {
  /** The integration access verdict for a block type, as `resolveIntegrationAccess` answers it. */
  access: (blockType: string) => 'available' | 'unconfigured' | 'requestable' | 'denied'
  /** Whether the deployment can complete an OAuth provider's sign-in; absent reads as available. */
  oauthAvailable: (providerId: string) => boolean | undefined
}

const ATLASSIAN_SERVICE_ACCOUNT_PROVIDER = 'atlassian-service-account'

/** The connection kinds this page can add a credential with; the rest list but cannot connect. */
const CONNECTABLE_KINDS: ReadonlySet<CredentialConnection['kind']> = new Set([
  'oauth',
  'service_account',
  'personal_token',
])

/**
 * Projects a catalog entry for a workspace's directory, or `null` when the viewer may not see it.
 * A denied app is hidden, as pickers hide it; a requestable one lists as `restricted` and an
 * unconfigured one lists, neither with a way to connect.
 */
export function projectWorkspaceApp(
  entry: IntegrationCatalogEntry,
  verdicts: WorkspaceAppVerdicts
): WorkspaceApp | null {
  const answer = verdicts.access(entry.type)
  if (answer === 'denied') return null
  const verdict: WorkspaceAppAccess = answer === 'requestable' ? 'restricted' : answer
  const connections =
    verdict === 'available'
      ? entry.connections.filter(
          (connection) =>
            CONNECTABLE_KINDS.has(connection.kind) &&
            (connection.kind !== 'oauth' ||
              verdicts.oauthAvailable(connection.providerId) !== false)
        )
      : []
  return {
    id: entry.id,
    type: entry.type,
    slug: entry.slug,
    name: entry.name,
    description: entry.description,
    category: entry.category,
    docsUrl: entry.docsUrl,
    access: verdict,
    credentialProviders: [...new Set(entry.connections.map((connection) => connection.providerId))],
    connections: connections.map(({ id, kind, label, providerId, setup, requiredScopes }) => ({
      id,
      kind,
      label,
      providerId,
      setup,
      requiredScopes,
      ...(providerId === ATLASSIAN_SERVICE_ACCOUNT_PROVIDER
        ? { atlassianProduct: entry.type.startsWith('confluence') ? 'confluence' : 'jira' }
        : {}),
    })),
    instanceLabels: Object.fromEntries(
      entry.connections.flatMap((connection) => {
        const field = connection.fields.find((item) => INSTANCE_FIELDS.has(item.id))
        return field ? [[connection.providerId, field.label]] : []
      })
    ),
  }
}

/** A workspace credential as the directory reads it. */
export interface WorkspaceConnectedCredential {
  id: string
  type: string
  providerId: string | null
  displayName: string
  description: string | null
  /** The immutable host a GitLab personal token connects to. */
  instanceUrl?: string
}

/** Credential kinds an app connects; secrets belong to workspace Settings. */
const APP_CREDENTIAL_TYPES: ReadonlySet<string> = new Set([
  'oauth',
  'service_account',
  'personal_token',
])

/** The credentials an app lists: those whose provider the app's connections name. */
export function appCredentials<T extends WorkspaceConnectedCredential>(
  app: Pick<WorkspaceApp, 'credentialProviders'>,
  credentials: readonly T[]
): T[] {
  return credentials.filter(
    (credential) =>
      APP_CREDENTIAL_TYPES.has(credential.type) &&
      credential.providerId !== null &&
      app.credentialProviders.includes(credential.providerId)
  )
}
