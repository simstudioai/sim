import { resolveChatOutputRecord } from '@/lib/copilot/tools/handlers/output-file-reader'
import { resolveChatUploadRecord } from '@/lib/copilot/tools/handlers/upload-file-reader'
import {
  resolveWorkspaceFileReference,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

/**
 * Resolve a tool input file path across every VFS namespace the agent can
 * reference: chat-scoped `uploads/<name>` and `outputs/<name>` (resolved by
 * chat + VFS name, raw or percent-encoded), and workspace `files/` paths /
 * `wf_` ids (delegated to {@link resolveWorkspaceFileReference}, which only
 * knows `context='workspace'` rows — the reason chat-scoped inputs need this
 * wrapper). Chat-scoped prefixes resolve to null without a chatId; uploads
 * are flat, so any trailing segment after the name is ignored.
 */
export async function resolveToolInputFile(params: {
  workspaceId: string
  chatId?: string
  path: string
}): Promise<WorkspaceFileRecord | null> {
  const { workspaceId, chatId, path } = params
  if (path.startsWith('uploads/')) {
    if (!chatId) return null
    const fileName = path.slice('uploads/'.length).split('/')[0]
    return resolveChatUploadRecord(chatId, fileName)
  }
  if (path.startsWith('outputs/')) {
    if (!chatId) return null
    const fileName = path.slice('outputs/'.length).split('/')[0]
    return resolveChatOutputRecord(chatId, fileName)
  }
  return resolveWorkspaceFileReference(workspaceId, path)
}
