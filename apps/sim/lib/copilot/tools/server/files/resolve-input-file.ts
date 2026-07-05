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
 * Chat-scoped prefixes fall through to the workspace resolver when no chatId
 * exists (no chat namespace can shadow anything); both chat namespaces are
 * flat, so any trailing segment after the name is ignored.
 */
export async function resolveToolInputFile(params: {
  workspaceId: string
  chatId?: string
  path: string
}): Promise<WorkspaceFileRecord | null> {
  const { workspaceId, chatId, path } = params
  // Without a chat there is no chat namespace to shadow, so an uploads/- or
  // outputs/-prefixed reference falls through to the workspace resolver —
  // keeping a real workspace folder literally named "uploads"/"outputs"
  // addressable by its bare spelling for headless callers (pre-namespace
  // behavior). WITH a chat, the chat namespace wins outright: falling back on
  // a miss could silently resolve a same-named workspace file when the agent
  // meant a chat file that doesn't exist.
  if (isUploadsPath(path)) {
    if (!chatId) return resolveWorkspaceFileReference(workspaceId, path)
    return resolveChatUploadRecord(chatId, chatScopedLeafSegment(path, 'uploads'))
  }
  if (isOutputsPath(path)) {
    if (!chatId) return resolveWorkspaceFileReference(workspaceId, path)
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
