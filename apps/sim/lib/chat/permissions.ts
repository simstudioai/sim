import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

/**
 * A chat deployed with `authType: 'public'` is invocable by anyone holding the
 * URL, with no authentication — the same unauthenticated exposure as a public
 * workflow API, which is admin-only. Deploying a chat itself only needs
 * `write`, so this gates the exposure rather than the deployment: an editor can
 * ship a password/email/SSO chat, but only an admin can make one public.
 *
 * Only the *transition to* public is gated. Editing an already-public chat, or
 * moving it off public, stays `write` — neither increases exposure.
 *
 * Lives in `lib/` rather than beside the chat routes because three separate
 * surfaces deploy chats — the REST create and update routes and the copilot use
 * case — and a rule duplicated per callsite is a rule that drifts. The copilot
 * path in particular defaults `authType` to `public`, so a missing check there
 * silently reopens the boundary.
 */
export async function canSetPublicChatAuth(userId: string, workspaceId: string): Promise<boolean> {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  return permission === 'admin'
}
