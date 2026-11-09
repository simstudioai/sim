import type { IntegrationCatalogEntry } from '@/platform/lib/integrations/catalog-model'
import type { CredentialConnection } from '@/platform/lib/integrations/credential-model'

/**
 * What the viewer may do with an app in one workspace, as the workspace's integration access policy
 * decides it: `available` connects, `unconfigured` is listed but this deployment cannot connect it.
 * An app the permission group restricts is not listed at all.
 */
type WorkspaceAppAccess = 'available' | 'unconfigured'

/** One connection method the deployment can complete, in the catalog's projection. */
export type WorkspaceAppConnection = Pick<
  CredentialConnection,
  'id' | 'kind' | 'label' | 'providerId' | 'setup' | 'requiredScopes'
>

/** An app of a workspace's Integrations directory: catalog metadata and the viewer's verdict. */
export interface WorkspaceApp {
  id: string
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
}

/** What the detail page adds for the one app it shows. */
export interface WorkspaceAppDetail extends WorkspaceApp {
  example: string
}

/** The verdicts one catalog projection reads, already resolved for the viewer and workspace. */
export interface WorkspaceAppVerdicts {
  /** The integration access verdict for a block type, as `resolveIntegrationAccess` answers it. */
  access: (blockType: string) => 'available' | 'unconfigured' | 'requestable' | 'denied'
  /** Whether the deployment can complete an OAuth provider's sign-in; absent reads as available. */
  oauthAvailable: (providerId: string) => boolean | undefined
}

/** The connection kinds this page can add a credential with; the rest list but cannot connect. */
const CONNECTABLE_KINDS: ReadonlySet<CredentialConnection['kind']> = new Set([
  'oauth',
  'service_account',
])

/**
 * Projects a catalog entry for a workspace's directory, or `null` when the viewer may not see it.
 * A restricted app is hidden, as pickers hide it; an unconfigured one lists with no way to connect.
 */
export function projectWorkspaceApp(
  entry: IntegrationCatalogEntry,
  verdicts: WorkspaceAppVerdicts
): WorkspaceApp | null {
  const verdict = verdicts.access(entry.type)
  if (verdict !== 'available' && verdict !== 'unconfigured') return null
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
    })),
  }
}

/** A workspace credential as the directory reads it. */
export interface WorkspaceConnectedCredential {
  id: string
  type: string
  providerId: string | null
  displayName: string
  description: string | null
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
