import type { AgentCliExecutionContext } from '@/lib/mothership/agent-cli'
import { createCopilotResourceAdmission } from '@/lib/mothership/auth/application-delegation'
import type { SandboxResourceScope } from '@/lib/mothership/tools/sandbox-resources'

/** Lease credentials and owner hints the callback consumed; the in-process request never carries them on. */
const CALLBACK_ONLY_HEADERS = [
  'host',
  'cookie',
  'authorization',
  'connection',
  'transfer-encoding',
  'x-api-key',
  'x-mothership-workspace-id',
  'x-mothership-file-owner',
] as const

/** The callback request's headers with its credentials and routing hints removed. */
export function forwardableSandboxHeaders(request: Request): Headers {
  const headers = new Headers(request.headers)
  for (const name of CALLBACK_ONLY_HEADERS) headers.delete(name)
  return headers
}

/** The admitted chat invocation a live callback lease acts for; each operation reauthorizes it. */
export function sandboxCallbackContext(
  scope: SandboxResourceScope,
  signal?: AbortSignal
): AgentCliExecutionContext {
  return {
    userId: scope.userId,
    chatId: scope.chatId,
    toolCallId: scope.toolCallId,
    copilotToolExecution: true,
    copilotResourceAdmission: createCopilotResourceAdmission({
      userId: scope.userId,
      invocation: { kind: 'chat', chatId: scope.chatId },
    }),
    ...(signal ? { signal } : {}),
  }
}
