import { v2DownloadProjectFileItemsContract } from '@/lib/api/contracts/v2/project-file-downloads'
import {
  defineV2BinaryRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { presentProjectFileDownload } from '@/lib/projects/files/api/download-presenter'
import { downloadProjectFileItems } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'

export const GET = defineV2BinaryRoute({
  contract: v2DownloadProjectFileItemsContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.downloadItems,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  headSafe: false,
  mapInput: ({ params, query }) => ({ projectId: params.projectId, ...query }),
  useCase: downloadProjectFileItems,
  present: presentProjectFileDownload,
})
