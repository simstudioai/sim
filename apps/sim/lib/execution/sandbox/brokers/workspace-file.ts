import { createLogger } from '@sim/logger'
import {
  MAX_ISOLATED_VM_BROKER_RESULT_JSON_CHARS,
  MAX_SANDBOX_IMAGE_DATA_URI_CHARS,
} from '@/lib/execution/isolated-vm-limits'
import type { SandboxBroker } from '@/lib/execution/sandbox/types'
import {
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const logger = createLogger('SandboxWorkspaceFileBroker')

interface WorkspaceFileArgs {
  fileId: string
}

interface WorkspaceFileResult {
  dataUri: string
}

/**
 * Host-side broker that resolves a workspace file id into a base64 data URI.
 *
 * Exposed to isolate code through `__brokers.workspaceFile(fileId)` and wrapped
 * by the task bootstrap as `getFileBase64(fileId)`.
 */
export const workspaceFileBroker: SandboxBroker<WorkspaceFileArgs, WorkspaceFileResult> = {
  name: 'workspaceFile',
  async handle(ctx, args) {
    if (!args || typeof args.fileId !== 'string' || args.fileId.length === 0) {
      throw new Error('workspaceFile broker requires a non-empty fileId')
    }
    if (!ctx.workspaceId) {
      throw new Error('workspaceFile broker requires a workspaceId')
    }

    const record = await getWorkspaceFile(ctx.workspaceId, args.fileId)
    if (!record) {
      logger.warn('Workspace file not found for sandbox broker', {
        workspaceId: ctx.workspaceId,
        fileId: args.fileId,
      })
      throw new Error(`File not found: ${args.fileId}`)
    }

    const mime = record.type || 'image/png'
    const dataUriPrefix = `data:${mime};base64,`
    const envelopeChars = JSON.stringify({ dataUri: dataUriPrefix }).length
    const availableBase64Chars = Math.max(
      0,
      Math.min(
        MAX_SANDBOX_IMAGE_DATA_URI_CHARS - dataUriPrefix.length,
        MAX_ISOLATED_VM_BROKER_RESULT_JSON_CHARS - envelopeChars
      )
    )
    const maxBytes = Math.floor(availableBase64Chars / 4) * 3
    const buffer = await fetchWorkspaceFileBuffer(record, { maxBytes })
    ctx.onWorkspaceFileAccess?.({
      fileId: record.id,
      key: record.key,
      context: record.storageContext ?? 'workspace',
      contentUpdatedAt: record.contentUpdatedAt ?? record.updatedAt,
    })
    return { dataUri: `${dataUriPrefix}${buffer.toString('base64')}` }
  },
}
