/**
 * Who a chat surface belongs to and where its open chat lives. A workspace surface passes its id.
 * An organization surface passes its organization, plus `workspaceId` when the chat it opened is a
 * workspace chat (every chat from before organization chats, and any chat on a workspace that
 * renders in the organization's shell): requests about that chat name its workspace, while the
 * surface's lists, links and handoffs stay the organization's.
 */
export type ChatSurfaceOwner = string | { organizationId: string; workspaceId?: string }

type ChatRequestScope =
  | { workspaceId: string; organizationId?: undefined }
  | { organizationId: string; workspaceId?: undefined }

/**
 * The scope a send, Stop or handoff about a surface's open chat names: the chat's own home. The
 * server admits a turn or a Stop only under the scope the chat was created in, so a workspace chat
 * open in an organization's shell names its workspace, never the organization showing it.
 */
export function chatRequestScope(owner: {
  workspaceId?: string
  organizationId?: string
}): ChatRequestScope {
  if (owner.workspaceId) return { workspaceId: owner.workspaceId }
  if (owner.organizationId) return { organizationId: owner.organizationId }
  throw new Error('A chat surface needs a workspace or an organization')
}
