import type { ChatContext } from '@/stores/panel'

/** Context kinds that carry an owning `workspaceId` (see `WorkspaceOwned`). */
const WORKSPACE_OWNED_CONTEXT_KINDS = [
  'past_chat',
  'workflow',
  'workflow_block',
  'logs',
  'knowledge',
  'table',
  'table_selection',
  'file',
  'file_selection',
  'folder',
  'filefolder',
  'skill',
] as const satisfies readonly ChatContext['kind'][]

export type WorkspaceOwnedContext = Extract<
  ChatContext,
  { kind: (typeof WORKSPACE_OWNED_CONTEXT_KINDS)[number] }
>

const WORKSPACE_OWNED_KINDS: ReadonlySet<ChatContext['kind']> = new Set(
  WORKSPACE_OWNED_CONTEXT_KINDS
)

export function isWorkspaceOwnedContext(context: ChatContext): context is WorkspaceOwnedContext {
  return WORKSPACE_OWNED_KINDS.has(context.kind)
}
