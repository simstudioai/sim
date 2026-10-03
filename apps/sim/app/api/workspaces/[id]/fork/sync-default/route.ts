import { updateForkSyncDefaultContract } from '@/lib/api/contracts/workspace-fork'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalForkErrorPolicy } from '@/ee/workspace-forking/api/route-policies'
import { forkOperations } from '@/ee/workspace-forking/application/operations'
import { setForkSyncDefault } from '@/ee/workspace-forking/application/sync-default'

export const PUT = defineInternalJsonRoute({
  contract: updateForkSyncDefaultContract,
  auth: internalSessionAuth,
  operation: forkOperations.syncDefault,
  /**
   * Rate-limited, unlike sibling fork routes: it writes the whole lineage under the coarsest
   * fork lock, so looping it could starve fork creation lineage-wide.
   */
  rateLimit: internalRateLimits.user({ bucketName: 'workspace-fork-sync-default' }),
  errorPolicy: internalForkErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, ...body }),
  present: ({ excludeNewWorkflows, changedWorkspaces }) => ({
    excludeNewWorkflows,
    workspacesUpdated: changedWorkspaces.length,
  }),
  useCase: setForkSyncDefault,
})
