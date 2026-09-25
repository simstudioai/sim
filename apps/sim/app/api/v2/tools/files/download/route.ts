import { v2DownloadToolFileContract } from '@/lib/api/contracts/v2/tool-files'
import {
  createV2ResourceConcealmentPolicy,
  defineV2BinaryRoute,
  v2ApiKeyAuth,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { downloadToolFile } from '@/lib/tool-execution/application/download-tool-file'
import { toolExecutionOperations } from '@/lib/tool-execution/application/operations'
import { encodeFilenameForHeader } from '@/app/api/files/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = defineV2BinaryRoute({
  contract: v2DownloadToolFileContract,
  auth: v2ApiKeyAuth,
  operation: toolExecutionOperations.downloadFile,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: createV2ResourceConcealmentPolicy({ notFoundMessage: 'File not found' }),
  headSafe: false,
  mapInput: ({ query }) => query,
  useCase: downloadToolFile,
  present: ({ file, stream, contentType, contentLength }) => ({
    body: stream,
    contentType,
    contentLength,
    contentDisposition: `attachment; ${encodeFilenameForHeader(file.originalName)}`,
    headers: { 'X-Content-Type-Options': 'nosniff' },
  }),
})
