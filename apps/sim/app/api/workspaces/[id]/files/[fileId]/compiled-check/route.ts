import { workspaceFileCompiledCheckContract } from '@/lib/api/contracts/workspace-files'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalFileErrorPolicies } from '@/lib/workspace-files/api'
import { compiledCheckWorkspaceFile } from '@/lib/workspace-files/application/compiled-check-workspace-file'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = defineInternalJsonRoute({
  contract: workspaceFileCompiledCheckContract,
  auth: internalSessionAuth,
  operation: compiledCheckWorkspaceFile.operation,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal compiled-check behavior',
  }),
  errorPolicy: internalFileErrorPolicies.compiledCheck,
  mapInput: ({ params }) => ({ fileId: params.fileId, assertedWorkspaceId: params.id }),
  useCase: compiledCheckWorkspaceFile,
})
