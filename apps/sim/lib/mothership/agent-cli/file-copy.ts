import type { EmbeddedCliIdentity } from 'sim/embed'
import { fileCopyInputSchema } from '@/lib/api/contracts/file-copy-input'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { AgentCliExecutionContext } from '@/lib/mothership/agent-cli'
import { executePreparedCliRequest, prepareCliSession } from '@/lib/mothership/agent-cli/execute'
import { createFileCopyCliTransport } from '@/lib/mothership/agent-cli/file-copy-transport'
import { createResourceEffectTransport } from '@/lib/mothership/agent-cli/resource-effects'
import { createTracedCliTransport } from '@/lib/mothership/agent-cli/traced-transport'
import { requireTrustedCopilotResourceExecutionContext } from '@/lib/mothership/auth/application-delegation'
import type { AgentCliRawResult, AgentCliRequest } from '@/lib/mothership/generated/agent-cli'

/** Executes one compound copy with both explicit owners and the original authoring invocation. */
export async function executeFileCopyCliRequest(
  request: AgentCliRequest,
  context: AgentCliExecutionContext
): Promise<AgentCliRawResult> {
  const { invocation } = request
  if (
    invocation.kind !== 'file-copy' ||
    request.fileOwner !== undefined ||
    request.workspaceId !== undefined ||
    request.curate !== undefined
  ) {
    throw new OrchestrationError(
      'validation',
      'File copy requires one explicit source and destination'
    )
  }
  const trustedContext = requireTrustedCopilotResourceExecutionContext(context)
  const target = fileCopyInputSchema.parse({
    source: invocation.source,
    destination: invocation.destination,
  })
  const { endpoint, sessionKey, files, resources } = prepareCliSession(context)
  const identity: EmbeddedCliIdentity = {
    endpoint,
    apiKey: 'mothership-in-process',
    transport: createResourceEffectTransport(
      endpoint,
      createTracedCliTransport(
        endpoint,
        createFileCopyCliTransport(endpoint, trustedContext, target)
      ),
      resources
    ),
    ...(context.signal ? { signal: context.signal } : {}),
  }
  return executePreparedCliRequest(request, {
    identity,
    sessionKey,
    files,
    resources,
    async augment() {
      throw new OrchestrationError('validation', 'File copy does not support augmentations')
    },
  })
}
