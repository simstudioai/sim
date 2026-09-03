import {
  v2DeleteSandboxContract,
  v2GetSandboxContract,
  v2UpdateSandboxContract,
} from '@/lib/api/contracts/v2/sandboxes'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { sandboxOperations } from '@/lib/sandboxes/application/operations'
import {
  deleteWorkspaceSandboxUseCase,
  getWorkspaceSandboxUseCase,
  updateWorkspaceSandboxUseCase,
} from '@/lib/sandboxes/application/use-cases'
import { sandboxResourceErrorPolicy } from '@/app/api/v2/sandboxes/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/sandboxes/[sandboxId] — Get one sandbox. */
export const GET = defineV2JsonRoute({
  contract: v2GetSandboxContract,
  operation: sandboxOperations.read,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: sandboxResourceErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: query.workspaceId,
    sandboxId: params.sandboxId,
  }),
  useCase: getWorkspaceSandboxUseCase,
  present: ({ sandbox }) => ({ data: sandbox }),
})

/** PATCH /api/v2/sandboxes/[sandboxId] — Update a sandbox and rebuild its image. */
export const PATCH = defineV2JsonRoute({
  contract: v2UpdateSandboxContract,
  operation: sandboxOperations.update,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: sandboxResourceErrorPolicy,
  mapInput: ({ params, body }) => ({
    ...body,
    sandboxId: params.sandboxId,
    source: 'api' as const,
  }),
  useCase: updateWorkspaceSandboxUseCase,
  present: ({ sandbox }) => ({ data: sandbox }),
})

/** DELETE /api/v2/sandboxes/[sandboxId] — Delete a sandbox. */
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteSandboxContract,
  operation: sandboxOperations.delete,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: sandboxResourceErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: query.workspaceId,
    sandboxId: params.sandboxId,
    source: 'api' as const,
  }),
  useCase: deleteWorkspaceSandboxUseCase,
  present: ({ sandbox }) => ({ data: { id: sandbox.id, deleted: true as const } }),
})
