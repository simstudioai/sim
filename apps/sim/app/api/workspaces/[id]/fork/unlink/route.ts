import { unlinkForkContract } from '@/lib/api/contracts/workspace-fork'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalForkErrorPolicy } from '@/ee/workspace-forking/api/route-policies'
import { forkOperations } from '@/ee/workspace-forking/application/operations'
import { unlinkWorkspaceFork } from '@/ee/workspace-forking/application/recovery-and-mappings'

export const POST = defineInternalJsonRoute({
  contract: unlinkForkContract,
  auth: internalSessionAuth,
  operation: forkOperations.unlink,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal fork request policy' }),
  errorPolicy: internalForkErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, ...body }),
  useCase: unlinkWorkspaceFork,
  present: (result) => result,
})
