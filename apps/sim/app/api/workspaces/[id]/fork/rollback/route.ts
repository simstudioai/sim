import { rollbackForkContract } from '@/lib/api/contracts/workspace-fork'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalForkErrorPolicy } from '@/ee/workspace-forking/api/route-policies'
import { forkOperations } from '@/ee/workspace-forking/application/operations'
import { rollbackWorkspaceFork } from '@/ee/workspace-forking/application/recovery-and-mappings'

export const POST = defineInternalJsonRoute({
  contract: rollbackForkContract,
  auth: internalSessionAuth,
  operation: forkOperations.rollback,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal fork request policy' }),
  errorPolicy: internalForkErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, ...body }),
  useCase: rollbackWorkspaceFork,
  present: (result) => result,
})
