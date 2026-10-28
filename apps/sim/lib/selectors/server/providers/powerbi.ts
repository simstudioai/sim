import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import { SelectorConnectionUnavailableError } from '@/lib/selectors/server/errors'
import type {
  ExecuteServerSelectorArgs,
  ServerSelectorAttachment,
  ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import { listPowerBIOptions, type PowerBIListingKind } from '@/tools/powerbi/listing'

function attachment(kind: PowerBIListingKind): ServerSelectorAttachment {
  return {
    credential: {
      kind: 'stored',
      field: 'oauthCredential',
      serviceIds: ['microsoft-powerbi'],
    },
    destination: 'fixed',
    execute: async (args: ExecuteServerSelectorArgs) => {
      args.signal?.throwIfAborted()
      if (!args.credential) throw new SelectorConnectionUnavailableError()
      const accessToken = await resolveSelectorOAuthAccessToken({
        credential: args.credential,
        serviceId: 'microsoft-powerbi',
        protectedValues: args.protectedValues,
        recordCredentialUse: args.recordCredentialUse,
      })
      return listPowerBIOptions({
        kind,
        accessToken,
        groupId: args.context.groupId,
        request: args.request,
        signal: args.signal,
      })
    },
  }
}

export const powerBISelectorAttachments = {
  'powerbi.workspaces': attachment('workspaces'),
  'powerbi.datasets': attachment('datasets'),
  'powerbi.reports': attachment('reports'),
} satisfies ServerSelectorAttachmentMap<
  'powerbi.workspaces' | 'powerbi.datasets' | 'powerbi.reports'
>
