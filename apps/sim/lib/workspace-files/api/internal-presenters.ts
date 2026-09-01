import { workspaceFileStyleContract } from '@/lib/api/contracts/workspace-files'
import { getBaseUrl } from '@/lib/core/utils/urls'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import type { DownloadWorkspaceFileResult } from '@/lib/workspace-files/application/download-workspace-file'

export const internalFilePresenters = {
  successFile({ file }: { file: WorkspaceFileRecord }) {
    return { success: true as const, file: { ...file, folderId: file.folderId ?? null } }
  },
  successFiles({ files }: { files: WorkspaceFileRecord[] }) {
    return {
      success: true as const,
      files: files.map((file) => ({ ...file, folderId: file.folderId ?? null })),
    }
  },
  downloadUrl({ file }: DownloadWorkspaceFileResult) {
    const baseUrl = getBaseUrl()
    return {
      success: true as const,
      downloadUrl: `${baseUrl}/api/files/serve/${encodeURIComponent(file.key)}?context=workspace`,
      viewerUrl: `${baseUrl}/workspace/${file.workspaceId}/files/${file.id}`,
      fileName: file.name,
      expiresIn: null,
    }
  },
  style(result: Parameters<typeof workspaceFileStyleContract.response.schema.parse>[0]) {
    return workspaceFileStyleContract.response.schema.parse(result)
  },
} as const
