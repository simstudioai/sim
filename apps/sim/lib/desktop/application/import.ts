import type { Principal } from '@sim/auth/principal'
import { toRecord } from '@sim/utils/object'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { DesktopDeviceUnrecognizedError } from '@/lib/desktop/executor/errors'
import { getBoundDesktopCall, getBoundDesktopDevice } from '@/lib/desktop/executor/repository'
import { ASYNC_TOOL_STATUS } from '@/lib/mothership/async-runs/lifecycle'
import { getAsyncToolCall } from '@/lib/mothership/async-runs/repository'
import {
  ensureWorkspaceFileChildFolder,
  loadActiveWorkspaceContext,
} from '@/lib/uploads/contexts/workspace'
import { resolveEffectiveMimeType } from '@/lib/uploads/utils/file-utils'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import {
  createAuthorizedWorkspaceFile,
  projectCreateWorkspaceFileAudit,
} from '@/lib/workspace-files/application/create-workspace-file'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export interface ImportDesktopEntryInput {
  deviceId: string
  toolCallId: string
  executionToken: string
  kind: 'file' | 'directory'
  sourceName: string
  relativePath: string
  /** A file's bytes; a directory has none. */
  content?: Buffer
}

const IMPORT_NOT_FOUND = 'Desktop import not found'

/**
 * The claimed import an entry belongs to: a running `import_local_files` call bound to this
 * device, presented with the token that claimed it, on the caller's own turn. The target
 * workspace and folder come from Sim's record of the call, never from the request; writing to
 * that workspace is then authorized as any file creation is.
 */
async function resolveImportContext({
  principal,
  input,
}: {
  principal: Principal
  input: ImportDesktopEntryInput
}) {
  if (principal.kind !== 'session') throw new OrchestrationError('not_found', IMPORT_NOT_FOUND)
  const device = await getBoundDesktopDevice({
    deviceId: input.deviceId,
    userId: principal.userId,
    sessionId: principal.sessionId,
  })
  if (!device) throw new DesktopDeviceUnrecognizedError()
  const [call, row] = await Promise.all([
    getBoundDesktopCall({ deviceId: input.deviceId, userId: principal.userId }, input.toolCallId),
    getAsyncToolCall(input.toolCallId),
  ])
  if (
    !call ||
    !row ||
    call.toolName !== 'import_local_files' ||
    call.ownerToken !== input.executionToken ||
    row.status !== ASYNC_TOOL_STATUS.running
  ) {
    throw new OrchestrationError('not_found', IMPORT_NOT_FOUND)
  }
  const args = toRecord(call.args)
  if (typeof args.targetWorkspaceId !== 'string') {
    throw new OrchestrationError('not_found', IMPORT_NOT_FOUND)
  }
  const workspace = await loadActiveWorkspaceContext(args.targetWorkspaceId)
  if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')
  return {
    ...workspace,
    rootFolderId: typeof args.folderId === 'string' ? args.folderId : null,
    importingUserId: principal.userId,
  }
}

const admitDesktopImportEntryUseCase = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.create,
  resolveContext: resolveImportContext,
  async execute() {},
})

/**
 * Admits an entry before its body is read, so a caller without a claimed, running import of its
 * own is refused without buffering the file. {@link importDesktopEntry} re-validates it.
 */
export async function admitDesktopImportEntry(
  principal: Principal,
  input: ImportDesktopEntryInput
): Promise<void> {
  await admitDesktopImportEntryUseCase.execute({ principal, input })
}

/**
 * Stores one entry of a desktop import. Each path segment is a folder under the call's target
 * folder: the source's own folder for a directory import, then the entry's parents. Existing
 * folders are reused; a file never overwrites one already there.
 */
export const importDesktopEntry = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.create,
  resolveContext: resolveImportContext,
  async execute({ principal, input, context }) {
    const segments = input.relativePath
      ? [input.sourceName, ...input.relativePath.split('/')]
      : [input.sourceName]
    const folders = input.kind === 'directory' ? segments : segments.slice(0, -1)
    let folderId = context.rootFolderId
    for (const name of folders) {
      folderId = await ensureWorkspaceFileChildFolder({
        workspaceId: context.workspaceId,
        userId: context.importingUserId,
        parentId: folderId,
        name,
      })
    }
    const name = segments[segments.length - 1] ?? input.sourceName
    if (input.kind === 'directory') {
      if (!folderId) throw new OrchestrationError('validation', 'A directory needs a name')
      return { kind: 'directory' as const, id: folderId, name }
    }
    const created = await createAuthorizedWorkspaceFile({
      principal,
      input: {
        workspaceId: context.workspaceId,
        name,
        contentType: resolveEffectiveMimeType(undefined, name),
        folderId,
        exactName: false,
      },
      content: input.content ?? Buffer.alloc(0),
      workspace: context,
    })
    return { kind: 'file' as const, id: created.file.id, name: created.file.name, created }
  },
  projectAudit: ({ result }) =>
    result.kind === 'file' ? projectCreateWorkspaceFileAudit(result.created) : [],
})
