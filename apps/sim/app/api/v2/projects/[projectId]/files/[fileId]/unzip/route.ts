import { v2UnzipProjectFileContract } from '@/lib/api/contracts/v2/project-file-extraction'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { buildFolderPath } from '@/lib/folders/paths'
import { extractProjectFile } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'

export const maxDuration = 300

export const POST = defineV2JsonRoute({
  contract: v2UnzipProjectFileContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.extractArchive,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealExtractionAuthorization,
  mapInput: ({ params }) => ({ projectId: params.projectId, fileId: params.fileId }),
  useCase: extractProjectFile,
  present: (result) => ({
    data: {
      folderPath: buildFolderPath(parseWorkspaceFileFolderDisplayPath(result.folderDisplayPath)),
      extractedFileCount: result.extractedCount,
      skippedFileCount: result.skippedCount,
    },
  }),
})
