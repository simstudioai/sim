import type { ServerSelectorAttachmentMap } from '@/lib/selectors/server/types'
import { listPlanetScaleOptions, type PlanetScaleListingKind } from '@/tools/planetscale/listing'

function attachment(kind: PlanetScaleListingKind) {
  return {
    integrationBlockTypes: ['planetscale'],
    destination: 'fixed' as const,
    execute: (
      args: Parameters<ServerSelectorAttachmentMap['planetscale.databases']['execute']>[0]
    ) =>
      listPlanetScaleOptions({
        kind,
        scope: {
          serviceTokenId: args.context.serviceTokenId!,
          serviceToken: args.context.serviceToken!,
          organization: args.context.organization!,
          database: args.context.database,
          branch: args.context.branch,
        },
        request: args.request,
        signal: args.signal,
      }),
  }
}

export const planetScaleSelectorAttachments = {
  'planetscale.databases': attachment('databases'),
  'planetscale.branches': attachment('branches'),
  'planetscale.backups': attachment('backups'),
  'planetscale.deployRequests': attachment('deployRequests'),
} satisfies ServerSelectorAttachmentMap<
  | 'planetscale.databases'
  | 'planetscale.branches'
  | 'planetscale.backups'
  | 'planetscale.deployRequests'
>
