import { MAX_PROJECT_FILE_SNAPSHOT_BODY_BYTES } from '@/lib/api/contracts/project-file-downloads'
import { v2ExportProjectFileSnapshotContract } from '@/lib/api/contracts/v2/project-file-downloads'
import {
  defineV2BinaryRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { presentProjectFileDownload } from '@/lib/projects/files/api/download-presenter'
import { exportProjectFileSnapshot } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'

export const POST = defineV2BinaryRoute({
  contract: v2ExportProjectFileSnapshotContract,
  parseOptions: { maxBodyBytes: MAX_PROJECT_FILE_SNAPSHOT_BODY_BYTES },
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.exportSnapshot,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, content: body.content }),
  useCase: exportProjectFileSnapshot,
  present: presentProjectFileDownload,
})
