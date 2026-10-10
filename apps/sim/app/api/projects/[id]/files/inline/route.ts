import { getInlineProjectFileContract } from '@/lib/api/contracts/project-files'
import {
  defineInternalBinaryRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { presentProjectFileContent } from '@/lib/projects/files/api'
import { readProjectInlineFile } from '@/lib/projects/files/application'

export const GET = defineInternalBinaryRoute({
  contract: getInlineProjectFileContract,
  auth: internalSessionAuth,
  headSafe: false,
  operation: readProjectInlineFile.operation,
  rateLimit: internalRateLimits.none({ reason: 'Authenticated embedded file delivery' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({
    projectId: params.id,
    key: query.key,
    referenceFileId: query.fileId,
  }),
  useCase: readProjectInlineFile,
  present: presentProjectFileContent,
})
