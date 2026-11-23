import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { SelectorConnectionUnavailableError } from '@/lib/selectors/server/errors'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import type {
  ExecuteServerSelectorArgs,
  ServerSelectorAttachment,
  ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import { listPlanetScaleOptions, type PlanetScaleListingKind } from '@/tools/planetscale/listing'
import type { PlanetScaleCredentials } from '@/tools/planetscale/types'

type PlanetScaleSelectorKey = Extract<ServerSelectorKey, `planetscale.${string}`>

const savedCredential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['planetscale'],
} as const

/** The service token pair typed into the legacy block; the listing refuses a missing half. */
function typedCredentials(args: ExecuteServerSelectorArgs): PlanetScaleCredentials {
  return {
    serviceTokenId: args.context.serviceTokenId ?? '',
    serviceToken: args.context.serviceToken ?? '',
  }
}

/** The service token pair of an authorized saved credential: its ID and its token. */
async function savedCredentials(args: ExecuteServerSelectorArgs): Promise<PlanetScaleCredentials> {
  const { accessToken, providerWorkspaceId } = await resolveSelectorCredentialBundle({
    credential: args.credential,
    protectedValues: args.protectedValues,
  })
  if (!providerWorkspaceId) throw new SelectorConnectionUnavailableError()
  return { serviceTokenId: providerWorkspaceId, serviceToken: accessToken }
}

function attachment(
  kind: PlanetScaleListingKind,
  credentials: (
    args: ExecuteServerSelectorArgs
  ) => PlanetScaleCredentials | Promise<PlanetScaleCredentials>,
  credential?: typeof savedCredential
): ServerSelectorAttachment {
  return {
    ...(credential ? { credential } : {}),
    integrationBlockTypes: ['planetscale'],
    destination: 'fixed',
    execute: async (args) =>
      listPlanetScaleOptions({
        kind,
        scope: {
          ...(await credentials(args)),
          organization: args.context.organization ?? '',
          database: args.context.database,
          branch: args.context.branch,
        },
        request: args.request,
        signal: args.signal,
      }),
  }
}

export const planetScaleSelectorAttachments = {
  'planetscale.databases': attachment('databases', typedCredentials),
  'planetscale.branches': attachment('branches', typedCredentials),
  'planetscale.backups': attachment('backups', typedCredentials),
  'planetscale.deployRequests': attachment('deployRequests', typedCredentials),
  'planetscale.savedDatabases': attachment('databases', savedCredentials, savedCredential),
  'planetscale.savedBranches': attachment('branches', savedCredentials, savedCredential),
  'planetscale.savedBackups': attachment('backups', savedCredentials, savedCredential),
  'planetscale.savedDeployRequests': attachment(
    'deployRequests',
    savedCredentials,
    savedCredential
  ),
} satisfies ServerSelectorAttachmentMap<PlanetScaleSelectorKey>
