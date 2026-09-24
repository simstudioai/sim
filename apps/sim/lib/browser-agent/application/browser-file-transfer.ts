import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { BROWSER_FILE_TRANSFER_MAX_BYTES } from '@sim/browser-protocol'
import { toRecord } from '@sim/utils/object'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { ASYNC_TOOL_STATUS, DESKTOP_TOOL_CLAIM_OWNER } from '@/lib/mothership/async-runs/lifecycle'
import {
  claimBrowserDownloadSave,
  getAsyncToolCall,
  getRunSegment,
} from '@/lib/mothership/async-runs/repository'
import {
  fetchWorkspaceFileBuffer,
  loadActiveWorkspaceContext,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import { resolveEffectiveMimeType } from '@/lib/uploads/utils/file-utils'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import {
  createAuthorizedWorkspaceFile,
  projectCreateWorkspaceFileAudit,
} from '@/lib/workspace-files/application/create-workspace-file'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveReferencedWorkspaceFileContext } from '@/lib/workspace-files/application/resolve-workspace-file-reference'

/** Local-folder paths are staged by the desktop itself and never read through the app. */
const USER_LOCAL_PREFIX = 'user-local/'

interface BrowserFileTransferBinding {
  workspaceId: string
  chatId: string
  args: Record<string, unknown>
}

/**
 * The claimed browser tool call a transfer belongs to. Only the desktop that claimed the call, acting
 * as the run's own user, may move its bytes, and only while the call is still executing — the
 * workspace, chat, and file references all come from the server-persisted row, never the request.
 */
async function loadBrowserFileTransferBinding(
  principal: Principal,
  toolCallId: string,
  toolName: 'browser_upload_file' | 'browser_save_download'
): Promise<BrowserFileTransferBinding> {
  const toolCall = await getAsyncToolCall(toolCallId)
  if (
    !toolCall ||
    toolCall.toolName !== toolName ||
    toolCall.status !== ASYNC_TOOL_STATUS.running ||
    toolCall.claimedBy !== DESKTOP_TOOL_CLAIM_OWNER.browser
  ) {
    throw new OrchestrationError('not_found', 'Browser file transfer not found')
  }
  const run = await getRunSegment(toolCall.runId)
  if (!run?.workspaceId || !run.chatId || run.userId !== resolvePrincipalSubjectUserId(principal)) {
    throw new OrchestrationError('not_found', 'Browser file transfer not found')
  }
  return { workspaceId: run.workspaceId, chatId: run.chatId, args: toRecord(toolCall.args) }
}

export interface ReadBrowserUploadFileInput {
  toolCallId: string
  index: number
}

export interface ReadBrowserUploadFileResult {
  file: WorkspaceFileRecord
  content: Buffer
}

/** Reads one workspace or chat-upload file a claimed `browser_upload_file` call attaches to a page. */
export const readBrowserUploadFile = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readContent,
  async resolveContext({
    principal,
    input,
  }: {
    principal: Principal
    input: ReadBrowserUploadFileInput
  }) {
    const binding = await loadBrowserFileTransferBinding(
      principal,
      input.toolCallId,
      'browser_upload_file'
    )
    const paths = Array.isArray(binding.args.paths) ? binding.args.paths : []
    const reference = paths[input.index]
    if (typeof reference !== 'string' || reference.startsWith(USER_LOCAL_PREFIX)) {
      throw new OrchestrationError('not_found', 'File not found')
    }
    return resolveReferencedWorkspaceFileContext(
      principal,
      { workspaceId: binding.workspaceId, reference, chatId: binding.chatId },
      { includeChatUploads: true }
    )
  },
  async execute({ context }): Promise<ReadBrowserUploadFileResult> {
    return {
      file: context.file,
      content: await fetchWorkspaceFileBuffer(context.file, {
        maxBytes: BROWSER_FILE_TRANSFER_MAX_BYTES,
      }),
    }
  },
})

export interface SaveBrowserDownloadInput {
  toolCallId: string
  /** The download's file name on this machine; the call's own `name` argument wins. */
  name: string
  content: Buffer
}

/** Stores a completed browser download as a workspace file for a claimed `browser_save_download` call. */
export const saveBrowserDownload = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.create,
  async resolveContext({
    principal,
    input,
  }: {
    principal: Principal
    input: SaveBrowserDownloadInput
  }) {
    const binding = await loadBrowserFileTransferBinding(
      principal,
      input.toolCallId,
      'browser_save_download'
    )
    const workspace = await loadActiveWorkspaceContext(binding.workspaceId)
    if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')
    const requestedName = binding.args.name
    return {
      ...workspace,
      name:
        typeof requestedName === 'string' && requestedName.trim()
          ? requestedName.trim()
          : input.name,
    }
  },
  async execute({ principal, input, context }) {
    if (!(await claimBrowserDownloadSave(input.toolCallId))) {
      throw new OrchestrationError(
        'conflict',
        'This download save has already started or is no longer active. It may already have created a file; inspect workspace files before trying another save.'
      )
    }
    return createAuthorizedWorkspaceFile({
      principal,
      input: {
        workspaceId: context.workspaceId,
        name: context.name,
        contentType: resolveEffectiveMimeType(undefined, context.name),
        exactName: false,
      },
      content: input.content,
      workspace: context,
    })
  },
  projectAudit: ({ result }) => projectCreateWorkspaceFileAudit(result),
})
