import { downloadProjectFileItemsContract } from '@/lib/api/contracts/project-file-downloads'
import {
  defineInternalBinaryRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { presentProjectFileDownload } from '@/lib/projects/files/api/download-presenter'
import { downloadProjectFileItems } from '@/lib/projects/files/application'

export const GET = defineInternalBinaryRoute({
  contract: downloadProjectFileItemsContract,
  auth: internalSessionAuth,
  operation: downloadProjectFileItems.operation,
  rateLimit: internalRateLimits.none({ reason: 'Authenticated bounded Project archive download' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({ projectId: params.id, ...query }),
  useCase: downloadProjectFileItems,
  present: presentProjectFileDownload,
})
