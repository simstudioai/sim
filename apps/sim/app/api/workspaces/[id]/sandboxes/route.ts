import { createLogger } from '@sim/logger'
import { createSandboxContract, listSandboxesContract } from '@/lib/api/contracts/sandboxes'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { sandboxOperations } from '@/lib/sandboxes/application/operations'
import {
  createWorkspaceSandboxUseCase,
  listWorkspaceSandboxesUseCase,
} from '@/lib/sandboxes/application/use-cases'
import { internalSandboxErrorPolicy } from '@/app/api/workspaces/[id]/sandboxes/error-policy'

const logger = createLogger('WorkspaceSandboxesAPI')

/**
 * The list is not plan-gated: a workspace that dropped below the Max tier must
 * still see what it built, and `entitled` drives whether the editor renders or
 * an upgrade prompt does. Name order is what the settings page has always
 * shown.
 */
export const GET = defineInternalJsonRoute({
  contract: listSandboxesContract,
  auth: internalSessionAuth,
  operation: sandboxOperations.list,
  rateLimit: internalRateLimits.none({
    reason: 'A small per-workspace read the legacy route never limited',
  }),
  errorPolicy: internalSandboxErrorPolicy,
  mapInput: ({ params }) => ({
    workspaceId: params.id,
    sortBy: 'name' as const,
    sortOrder: 'asc' as const,
  }),
  useCase: listWorkspaceSandboxesUseCase,
  present: ({ sandboxes, strategy, entitled }) => ({ sandboxes, strategy, entitled }),
})

export const POST = defineInternalJsonRoute({
  contract: createSandboxContract,
  auth: internalSessionAuth,
  operation: sandboxOperations.create,
  rateLimit: internalRateLimits.none({
    reason: 'Build admission is the per-workspace budget the use case enforces',
  }),
  errorPolicy: internalSandboxErrorPolicy,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    ...body,
    source: 'settings' as const,
  }),
  useCase: createWorkspaceSandboxUseCase,
  onSuccess: ({ input, result }) => {
    logger.info('Created workspace sandbox', {
      workspaceId: input.workspaceId,
      sandboxId: result.sandbox.id,
      language: result.sandbox.language,
    })
  },
  present: ({ sandbox }) => ({ sandbox }),
})
