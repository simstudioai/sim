import { createLogger } from '@sim/logger'
import { deleteSandboxContract, updateSandboxContract } from '@/lib/api/contracts/sandboxes'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { sandboxOperations } from '@/lib/sandboxes/application/operations'
import {
  deleteWorkspaceSandboxUseCase,
  updateWorkspaceSandboxUseCase,
} from '@/lib/sandboxes/application/use-cases'
import { internalSandboxResourceErrorPolicy } from '@/app/api/workspaces/[id]/sandboxes/error-policy'

const logger = createLogger('WorkspaceSandboxAPI')

const rateLimit = internalRateLimits.none({
  reason: 'Build admission is the per-workspace budget the use case enforces',
})

export const PATCH = defineInternalJsonRoute({
  contract: updateSandboxContract,
  auth: internalSessionAuth,
  operation: sandboxOperations.update,
  rateLimit,
  errorPolicy: internalSandboxResourceErrorPolicy,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    sandboxId: params.sandboxId,
    ...body,
    source: 'settings' as const,
  }),
  useCase: updateWorkspaceSandboxUseCase,
  onSuccess: ({ input }) => {
    logger.info('Updated workspace sandbox', {
      workspaceId: input.workspaceId,
      sandboxId: input.sandboxId,
    })
  },
  present: ({ sandbox }) => ({ sandbox }),
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteSandboxContract,
  auth: internalSessionAuth,
  operation: sandboxOperations.delete,
  rateLimit,
  errorPolicy: internalSandboxResourceErrorPolicy,
  mapInput: ({ params }) => ({
    workspaceId: params.id,
    sandboxId: params.sandboxId,
    source: 'settings' as const,
  }),
  useCase: deleteWorkspaceSandboxUseCase,
  onSuccess: ({ input }) => {
    logger.info('Deleted workspace sandbox', {
      workspaceId: input.workspaceId,
      sandboxId: input.sandboxId,
    })
  },
  present: () => ({ success: true as const }),
})
