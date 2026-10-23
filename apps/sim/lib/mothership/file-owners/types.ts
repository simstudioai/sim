import type { AgentCliExecutionContext } from '@/lib/mothership/agent-cli'
import type { CopilotExecutionContext } from '@/lib/mothership/auth/application-delegation'
import type { AgentCliRawResult, AgentCliRequest } from '@/lib/mothership/generated/agent-cli'
import type { FileOwnerContext } from '@/lib/mothership/generated/file-owner'
import type { EditableFileOwner, FileOwner, OwnedFileTarget } from '@/lib/workspace-files/ownership'

export interface ChatFileIngress {
  userId: string
  workspaceId?: string
  chatId?: string
  requestMode?: string
}

interface ChatFileMetadata {
  id: string
  name: string
  owner: EditableFileOwner
  path: string
}

/**
 * Per-owner Copilot file policy: CLI execution, metadata reads, and capability hints, each
 * reauthorized by the owner's use cases.
 */
export interface CopilotFileOwnerAdapter {
  /**
   * `workspace`: legacy workspace files share the invocation's workspace with other resource
   * kinds. `owner`: the owner binds its own invocation and never takes a workspace target.
   */
  invocationScope: 'workspace' | 'owner'
  executeCli(
    request: AgentCliRequest,
    context: AgentCliExecutionContext,
    owner: FileOwner
  ): Promise<AgentCliRawResult>
  readMetadata(
    context: CopilotExecutionContext | undefined,
    target: OwnedFileTarget
  ): Promise<{ id: string; name: string; owner: EditableFileOwner }>
  readChatMetadata(ingress: ChatFileIngress, target: OwnedFileTarget): Promise<ChatFileMetadata>
  capabilities?(
    context: CopilotExecutionContext,
    owner: FileOwner
  ): Promise<FileOwnerContext['fileOwnerCapabilities'][number]>
}
