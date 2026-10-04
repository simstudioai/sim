import { readProjectFileArtifactContract } from '@/lib/api/contracts/project-files'
import {
  defineInternalBinaryRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { presentProjectFileContent } from '@/lib/projects/files/api'
import { readProjectFileArtifact } from '@/lib/projects/files/application'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

export const GET = defineInternalBinaryRoute({
  contract: readProjectFileArtifactContract,
  auth: internalSessionAuth,
  operation: readProjectFileArtifact.operation,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated bounded file rendering follows the existing private preview policy',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({
    projectId: params.id,
    fileId: params.fileId,
    maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
  }),
  useCase: readProjectFileArtifact,
  present: ({ file, buffer, contentType }) =>
    presentProjectFileContent({ file: { ...file, type: contentType }, content: buffer }),
})
