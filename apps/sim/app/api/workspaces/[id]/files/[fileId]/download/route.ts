import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { downloadWorkspaceFileUrlContract } from '@/lib/api/contracts/workspace-files'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { captureServerEvent } from '@/lib/posthog/server'
import { internalFileErrorPolicy } from '@/lib/workspace-files/api'
import { downloadWorkspaceFile } from '@/lib/workspace-files/application/download-workspace-file'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceFileDownloadAPI')

const downloadErrorPolicy = {
  render(error: unknown) {
    const typed = internalFileErrorPolicy.render(error)
    if (typed) return typed
    logger.error('Failed to generate workspace file download URL', { error })
    return NextResponse.json(
      { success: false, error: 'Failed to generate download URL' },
      { status: 500 }
    )
  },
}

/** POST /api/workspaces/[id]/files/[fileId]/download — Create an authenticated serve URL. */
export const POST = defineInternalJsonRoute({
  contract: downloadWorkspaceFileUrlContract,
  auth: internalSessionAuth,
  operation: downloadWorkspaceFile.operation,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal download behavior' }),
  errorPolicy: downloadErrorPolicy,
  mapInput: ({ params }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: params.id,
  }),
  useCase: downloadWorkspaceFile,
  onSuccess: ({ principal, result }) => {
    captureServerEvent(
      principal.userId,
      'file_downloaded',
      { workspace_id: result.file.workspaceId, is_bulk: false, file_count: 1 },
      { groups: { workspace: result.file.workspaceId } }
    )
  },
  present: ({ file }) => {
    const baseUrl = getBaseUrl()
    return {
      success: true as const,
      downloadUrl: `${baseUrl}/api/files/serve/${encodeURIComponent(file.key)}?context=workspace`,
      viewerUrl: `${baseUrl}/workspace/${file.workspaceId}/files/${file.id}`,
      fileName: file.name,
      expiresIn: null,
    }
  },
})
