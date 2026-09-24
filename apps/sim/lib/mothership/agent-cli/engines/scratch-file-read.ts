import { OrchestrationError } from '@/lib/core/orchestration/types'
import { observePrivateFile } from '@/lib/mothership/agent-cli/engines/observe-private-file'
import type { AgentCliFlags, AgentCliRuntime } from '@/lib/mothership/agent-cli/types'
import { readChatSandboxFile } from '@/lib/mothership/chat/application/read-sandbox-file'

/** The authorized scratch snapshot never becomes a workspace file or resource-panel entry. */
export async function readScratchFile(
  reference: string,
  runtime: AgentCliRuntime,
  flags: AgentCliFlags,
  options: { maxBytes?: number; offset?: number; limit?: number }
) {
  if (!runtime.principal || !runtime.chatId)
    throw new OrchestrationError('unauthorized', 'Scratch reads require an authenticated chat')
  const file = await readChatSandboxFile.execute({
    principal: runtime.chatPrincipal ?? runtime.principal,
    input: {
      chatId: runtime.chatId,
      ...(runtime.chatOrganizationId
        ? { organizationId: runtime.chatOrganizationId }
        : { workspaceId: runtime.workspaceId }),
      path: reference,
      maxBytes: options.maxBytes,
      signal: runtime.signal,
    },
  })
  return observePrivateFile({ ...file, source: 'sandbox' }, flags, options, runtime.signal)
}
