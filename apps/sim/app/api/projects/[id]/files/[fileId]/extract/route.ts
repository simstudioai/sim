import { extractProjectFileContract } from '@/lib/api/contracts/project-file-extraction'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { extractProjectFile } from '@/lib/projects/files/application'
import { internalFileErrorPolicies } from '@/lib/workspace-files/api'

export const maxDuration = 300

export const POST = defineInternalJsonRoute({
  contract: extractProjectFileContract,
  auth: internalSessionAuth,
  operation: extractProjectFile.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.write' }),
  errorPolicy: internalFileErrorPolicies.extractArchive,
  mapInput: ({ params }) => ({ projectId: params.id, fileId: params.fileId }),
  useCase: extractProjectFile,
  present: (result) => ({ success: true, ...result }),
})
