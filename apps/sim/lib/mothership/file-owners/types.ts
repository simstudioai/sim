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

export interface CopilotFileOwnerAdapter {
  /** Legacy workspace resources share an invocation with other workspace resource kinds. */
  resourceScope: 'workspace' | 'owner'
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
