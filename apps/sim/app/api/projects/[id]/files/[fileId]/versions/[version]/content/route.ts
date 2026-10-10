import { readProjectFileVersionContentContract } from '@/lib/api/contracts/project-file-versions'
import {
  defineInternalBinaryRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { presentProjectFileVersionContent } from '@/lib/projects/files/api'
import { readProjectFileVersionContent } from '@/lib/projects/files/application'
export const GET = defineInternalBinaryRoute({
  contract: readProjectFileVersionContentContract,
  auth: internalSessionAuth,
  headSafe: false,
  operation: readProjectFileVersionContent.operation,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated historical byte delivery follows the workspace download policy',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({
    projectId: params.id,
    fileId: params.fileId,
    version: params.version,
  }),
  useCase: readProjectFileVersionContent,
  present: presentProjectFileVersionContent,
})
