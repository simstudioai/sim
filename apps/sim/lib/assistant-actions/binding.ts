import type { AssistantActionBinding } from '@sim/db/schema'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { assertAssistantIntegrationCall } from '@/lib/mothership/assistant/tool-policy'
import { getToolMetadata } from '@/tools/metadata'

/** Registry metadata and validated account arguments seal the scope of a proposed operation. */
export function resolveAssistantActionBinding(
  toolId: string,
  args: Record<string, unknown>
): AssistantActionBinding {
  if (Buffer.byteLength(JSON.stringify(args), 'utf8') > 65_536)
    throw new OrchestrationError(
      'payload_too_large',
      'This action is too large to review. Ask Assistant to split it into smaller actions.'
    )
  const { credentialId, operation } = assertAssistantIntegrationCall(getToolMetadata(toolId), args)
  return { credentialId, operationVersion: operation.version, effect: operation.effect }
}
