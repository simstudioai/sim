import { exportProjectFileSnapshotContract } from '@/lib/api/contracts/project-file-downloads'
import {
  defineInternalBinaryRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { presentProjectFileDownload } from '@/lib/projects/files/api/download-presenter'
import { exportProjectFileSnapshot } from '@/lib/projects/files/application'

export const POST = defineInternalBinaryRoute({
  contract: exportProjectFileSnapshotContract,
  auth: internalSessionAuth,
  operation: exportProjectFileSnapshot.operation,
  rateLimit: internalRateLimits.none({ reason: 'Authenticated bounded Markdown snapshot export' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ projectId: params.id, fileId: params.fileId, ...body }),
  useCase: exportProjectFileSnapshot,
  present: presentProjectFileDownload,
})
