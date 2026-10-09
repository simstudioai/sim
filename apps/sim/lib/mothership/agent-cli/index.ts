import { executeFileCopyCliRequest } from '@/lib/mothership/agent-cli/file-copy'
import { executeAgentCliService } from '@/lib/mothership/agent-cli/services'
import { executeWorkspaceCliRequest } from '@/lib/mothership/agent-cli/workspace'
import { getCopilotFileOwnerAdapter } from '@/lib/mothership/file-owners'
import type { AgentCliRawResult, AgentCliRequest } from '@/lib/mothership/generated/agent-cli'
import type { ServerToolContext } from '@/lib/mothership/tools/server/base-tool'

export interface AgentCliExecutionContext extends Omit<ServerToolContext, 'abortSignal'> {
  signal?: AbortSignal
}

/** Dispatches explicit file owners through registered policy adapters; non-file commands retain their scope. */
export async function executeAgentCliRequest(
  request: AgentCliRequest,
  context: AgentCliExecutionContext
): Promise<AgentCliRawResult> {
  context.signal?.throwIfAborted()
  if (request.invocation.kind === 'file-copy') {
    return executeFileCopyCliRequest(request, context)
  }
  if (request.fileOwner) {
    const owner = Object.freeze({ ...request.fileOwner })
    return getCopilotFileOwnerAdapter(owner).executeCli(
      { ...request, fileOwner: owner },
      context,
      owner
    )
  }
  if (
    request.invocation.kind === 'service' ||
    (request.invocation.kind === 'stdout' &&
      request.workspaceId === undefined &&
      (context.chatOrganizationId || context.organizationId))
  ) {
    return executeAgentCliService(request, context)
  }
  return executeWorkspaceCliRequest(request, context)
}
