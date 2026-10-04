import { getProjectCsvPreviewContract } from '@/lib/api/contracts/project-files'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { readProjectFileCsvPreview } from '@/lib/projects/files/application'

export const GET = defineInternalJsonRoute({
  contract: getProjectCsvPreviewContract,
  auth: internalSessionAuth,
  operation: readProjectFileCsvPreview.operation,
  rateLimit: internalRateLimits.none({ reason: 'Authenticated bounded CSV preview' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }, { request }) => ({
    projectId: params.id,
    fileId: params.fileId,
    key: query.key,
    signal: request.signal,
  }),
  useCase: readProjectFileCsvPreview,
  present: ({ success, headers, rows, truncated }) => ({ success, headers, rows, truncated }),
})
