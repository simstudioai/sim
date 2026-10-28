import { OAUTH_API_READ_SCOPE } from '@/lib/auth/oauth-provider'
import { countWithheldContent } from '@/lib/core/application'
import { withDelegatedApiScopes } from '@/lib/core/application/delegated-api-scopes'
import { executeFileCopyCliRequest } from '@/lib/mothership/agent-cli/file-copy'
import { isReadOnlyCliRequest } from '@/lib/mothership/agent-cli/read-only'
import { executeAgentCliService } from '@/lib/mothership/agent-cli/services'
import { executeWorkspaceCliRequest } from '@/lib/mothership/agent-cli/workspace'
import { describeWithheldContent } from '@/lib/mothership/content-delivery/telemetry'
import { getCopilotFileOwnerAdapter } from '@/lib/mothership/file-owners'
import type { AgentCliRawResult, AgentCliRequest } from '@/lib/mothership/generated/agent-cli'
import type { ServerToolContext } from '@/lib/mothership/tools/server/base-tool'

export interface AgentCliExecutionContext extends Omit<ServerToolContext, 'abortSignal'> {
  readOnly?: boolean
  /** Null when the run has no caller of its own, as for an unattributed inbox message. */
  secretActorUserId?: string | null
  signal?: AbortSignal
}

/** Dispatches explicit file owners through registered policy adapters; non-file commands retain their scope. */
export async function executeAgentCliRequest(
  request: AgentCliRequest,
  context: AgentCliExecutionContext
): Promise<AgentCliRawResult> {
  const execute = () => executeUncountedAgentCliRequest(request, context)
  // Commands authorize the subject's live role; a callerless inbox run's subject is the owner.
  const { result, withheld } = await countWithheldContent(() =>
    context.secretActorUserId === null
      ? withDelegatedApiScopes([OAUTH_API_READ_SCOPE], execute)
      : execute()
  )
  const note = describeWithheldContent(withheld)
  if (!note) return result
  return { ...result, stderr: result.stderr ? `${result.stderr}\n${note}` : note }
}

async function executeUncountedAgentCliRequest(
  request: AgentCliRequest,
  context: AgentCliExecutionContext
): Promise<AgentCliRawResult> {
  context.signal?.throwIfAborted()
  if (context.readOnly && !isReadOnlyCliRequest(request)) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'This operation is unavailable during benchmark reference generation.',
    }
  }
  if (request.invocation.kind === 'file-copy') {
    return executeFileCopyCliRequest(request, context)
  }
  /** Services validate their own targets, including refusing a file owner, so they dispatch first. */
  if (request.invocation.kind === 'service') {
    return executeAgentCliService(request, context)
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
    request.invocation.kind === 'stdout' &&
    request.workspaceId === undefined &&
    (context.chatOrganizationId || context.organizationId)
  ) {
    return executeAgentCliService(request, context)
  }
  return executeWorkspaceCliRequest(request, context)
}
