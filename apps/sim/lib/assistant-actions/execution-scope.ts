import { AsyncLocalStorage } from 'node:async_hooks'
import { isDeepStrictEqual } from 'node:util'
import type { AssistantActionBinding } from '@sim/db/schema'
import { authorizeOrganizationAssistantRead } from '@/lib/assistant-actions/application/admission'
import { resolveAssistantActionBinding } from '@/lib/assistant-actions/binding'
import { executeCopilotAssistantAction } from '@/lib/mothership/application/assistant-actions'
import type { CopilotExecutionContext } from '@/lib/mothership/auth/application-delegation'

interface AdmittedAction {
  userId: string
  organizationId: string
  toolCallId: string
  toolId: string
  args: Record<string, unknown>
  binding: AssistantActionBinding
}

const executions = new AsyncLocalStorage<AdmittedAction & { consumed: boolean }>()

/** Only the winning durable execution enters this scope; its authority cannot cross a wire. */
export function withAssistantActionExecution<T>(
  action: AdmittedAction,
  execute: () => Promise<T>
): Promise<T> {
  return executions.run({ ...action, args: structuredClone(action.args), consumed: false }, execute)
}

/** The provider boundary consumes one exact invocation, including edits approved in the saved decision. */
export async function requireAssistantActionExecution(
  context: CopilotExecutionContext,
  toolId: string,
  args: Record<string, unknown>
): Promise<void> {
  const binding = resolveAssistantActionBinding(toolId, args)
  const admitted = executions.getStore()
  if (
    admitted &&
    admitted.userId === context.userId &&
    admitted.organizationId === context.organizationId &&
    admitted.toolCallId === context.toolCallId &&
    admitted.toolId === toolId
  ) {
    if (
      admitted.consumed ||
      !isDeepStrictEqual(admitted.args, args) ||
      !isDeepStrictEqual(admitted.binding, binding)
    )
      throw new Error('This operation does not match its admitted Assistant action.')
    admitted.consumed = true
    return
  }
  if (binding.effect !== 'read')
    throw new Error('Write actions require an approved, durable Assistant tool call.')
  if (context.organizationId)
    await executeCopilotAssistantAction(context, authorizeOrganizationAssistantRead, {
      toolId,
      args,
    })
}
