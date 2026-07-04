import {
  resolveChatFileRecordById,
  resolveChatOutputRecord,
  resolveChatUploadRecord,
} from '@/lib/copilot/tools/handlers/chat-file-reader'
import { chatScopedLeafSegment, isOutputsPath, isUploadsPath } from '@/lib/copilot/vfs/path-utils'
import {
  resolveWorkspaceFileReference,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

/**
 * Resolve a tool input file reference across every VFS namespace the agent
 * can hold: chat-scoped `uploads/<name>` and `outputs/<name>` (resolved by
 * chat + VFS name, raw or percent-encoded), workspace `files/` paths, and
 * bare `wf_` ids. A `wf_` id resolves against the workspace first and then
 * against the chat's own uploads/outputs — {@link resolveWorkspaceFileReference}
 * pins `context='workspace'`, so a chat-scoped id would otherwise fail even
 * though the agent legitimately holds it (the reason this wrapper exists).
 * Chat-scoped prefixes resolve to null without a chatId; both chat namespaces
 * are flat, so any trailing segment after the name is ignored.
 */
export async function resolveToolInputFile(params: {
  workspaceId: string
  chatId?: string
  path: string
}): Promise<WorkspaceFileRecord | null> {
  const { workspaceId, chatId, path } = params
  if (isUploadsPath(path)) {
    if (!chatId) return null
    return resolveChatUploadRecord(chatId, chatScopedLeafSegment(path, 'uploads'))
  }
  if (isOutputsPath(path)) {
    if (!chatId) return null
    return resolveChatOutputRecord(chatId, chatScopedLeafSegment(path, 'outputs'))
  }
  const workspaceRecord = await resolveWorkspaceFileReference(workspaceId, path)
  if (workspaceRecord) return workspaceRecord

  const trimmed = path.trim()
  if (chatId && trimmed.startsWith('wf_')) {
    return resolveChatFileRecordById(chatId, trimmed)
  }
  return null
}
