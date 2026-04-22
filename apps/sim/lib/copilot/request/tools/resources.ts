import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1ResourceOp,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { withCopilotSpan } from '@/lib/copilot/request/otel'
import type { StreamEvent, ToolCallResult } from '@/lib/copilot/request/types'
import {
  extractDeletedResourcesFromToolResult,
  extractResourcesFromToolResult,
  hasDeleteCapability,
  isResourceToolName,
  persistChatResources,
  removeChatResources,
} from '@/lib/copilot/resources/persistence'

const logger = createLogger('CopilotResourceEffects')

/**
 * Persist and emit resource events after a successful tool execution.
 *
 * Handles both creation/upsert and deletion of chat resources depending on
 * the tool's capabilities and output shape.
 */
export async function handleResourceSideEffects(
  toolName: string,
  params: Record<string, unknown> | undefined,
  result: ToolCallResult,
  chatId: string,
  onEvent: ((event: StreamEvent) => void | Promise<void>) | undefined,
  isAborted: () => boolean
): Promise<void> {
  // Cheap early exit so we don't emit a span for tools that can never
  // produce resources (most of them). The span only shows up for tools
  // that might actually do resource work.
  if (
    !hasDeleteCapability(toolName) &&
    !isResourceToolName(toolName) &&
    !(result.resources && result.resources.length > 0)
  ) {
    return
  }

  return withCopilotSpan(
    TraceSpan.CopilotToolsHandleResourceSideEffects,
    {
      [TraceAttr.ToolName]: toolName,
      [TraceAttr.ChatId]: chatId,
    },
    async (span) => {
      let isDeleteOp = false
      let removedCount = 0
      let upsertedCount = 0

      if (hasDeleteCapability(toolName)) {
        const deleted = extractDeletedResourcesFromToolResult(toolName, params, result.output)
        if (deleted.length > 0) {
          isDeleteOp = true
          removedCount = deleted.length
          // Detached from the span lifecycle — the span ends before the
          // DB call completes. That is intentional; we want the span to
          // reflect the synchronous decision + event emission, not the
          // best-effort persistence.
          removeChatResources(chatId, deleted).catch((err) => {
            logger.warn('Failed to remove chat resources after deletion', {
              chatId,
              error: toError(err).message,
            })
          })

          for (const resource of deleted) {
            if (isAborted()) break
            await onEvent?.({
              type: MothershipStreamV1EventType.resource,
              payload: {
                op: MothershipStreamV1ResourceOp.remove,
                resource: { type: resource.type, id: resource.id, title: resource.title },
              },
            })
          }
        }
      }

      if (!isDeleteOp && !isAborted()) {
        const resources =
          result.resources && result.resources.length > 0
            ? result.resources
            : isResourceToolName(toolName)
              ? extractResourcesFromToolResult(toolName, params, result.output)
              : []

        if (resources.length > 0) {
          upsertedCount = resources.length
          logger.info('[file-stream-server] Emitting resource upsert events', {
            toolName,
            chatId,
            resources: resources.map((r) => ({ type: r.type, id: r.id, title: r.title })),
          })
          persistChatResources(chatId, resources).catch((err) => {
            logger.warn('Failed to persist chat resources', {
              chatId,
              error: toError(err).message,
            })
          })

          for (const resource of resources) {
            if (isAborted()) break
            await onEvent?.({
              type: MothershipStreamV1EventType.resource,
              payload: {
                op: MothershipStreamV1ResourceOp.upsert,
                resource: { type: resource.type, id: resource.id, title: resource.title },
              },
            })
          }
        }
      }

      span.setAttributes({
        [TraceAttr.CopilotResourcesOp]: isDeleteOp
          ? 'delete'
          : upsertedCount > 0
            ? 'upsert'
            : 'none',
        [TraceAttr.CopilotResourcesRemovedCount]: removedCount,
        [TraceAttr.CopilotResourcesUpsertedCount]: upsertedCount,
        [TraceAttr.CopilotResourcesAborted]: isAborted(),
      })
    }
  )
}
