import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1ResourceOp,
} from '@/lib/mothership/generated/mothership-stream-v1'
import { ResourceType } from '@/lib/mothership/generated/resources'
import { TraceAttr } from '@/lib/mothership/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/mothership/generated/trace-spans-v1'
import { withCopilotSpan } from '@/lib/mothership/request/otel'
import type { StreamEvent, ToolCallResult } from '@/lib/mothership/request/types'
import {
  extractDeletedResourcesFromToolResult,
  extractResourcesFromToolResult,
  hasDeleteCapability,
  isResourceToolName,
  persistChatResources,
  removeChatResources,
} from '@/lib/mothership/resources/persistence'
import { searchResultFromToolResult } from '@/lib/mothership/resources/search-tool-result'
import { changeStoredChatResources } from '@/lib/mothership/resources/store'
import type {
  MothershipResourceType,
  MothershipResourceUpdate,
} from '@/lib/mothership/resources/types'

const logger = createLogger('CopilotResourceEffects')

const PANEL_SETTINGS_SECTIONS: Partial<Record<MothershipResourceType, string>> = {
  skill: 'skills',
  custom_tool: 'custom-tools',
  mcp_server: 'mcp',
}

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
  projectedResult: ToolCallResult,
  chatId: string,
  onEvent: ((event: StreamEvent) => void | Promise<void>) | undefined,
  isAborted: () => boolean,
  owner?: { organizationId?: string; workspaceId?: string },
  actorUserId?: string
): Promise<void> {
  // Only organization chats address a workspace; a workspace chat's resources leave it implicit.
  const workspaceId = owner?.organizationId ? owner.workspaceId : undefined
  const refreshPanelSettings = async (resource: MothershipResourceUpdate) => {
    const section = PANEL_SETTINGS_SECTIONS[resource.type]
    const resourceWorkspaceId = resource.workspaceId ?? owner?.workspaceId
    if (!section || !resourceWorkspaceId) return
    await onEvent?.({
      type: MothershipStreamV1EventType.resource,
      payload: {
        op: 'refresh',
        resource: {
          type: 'settings',
          scope: 'workspace',
          workspaceId: resourceWorkspaceId,
          id: section,
        },
      },
    })
  }
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
        const deleted = extractDeletedResourcesFromToolResult(toolName, params, result.output).map(
          (resource) => ({ ...resource, ...(workspaceId ? { workspaceId } : {}) })
        )
        const projectedDeleted = extractDeletedResourcesFromToolResult(
          toolName,
          params,
          projectedResult.output
        )
        if (deleted.length > 0) {
          isDeleteOp = true
          removedCount = deleted.length
          // Panel refreshes re-read stored chat resources, so they must follow the write.
          const removal = removeChatResources(chatId, deleted).catch((err) => {
            logger.warn('Failed to remove chat resources after deletion', {
              chatId,
              error: toError(err).message,
            })
          })
          if (deleted.some((resource) => PANEL_SETTINGS_SECTIONS[resource.type])) await removal

          for (let index = 0; index < deleted.length; index += 1) {
            if (isAborted()) break
            const resource = deleted[index]
            const projected = projectedDeleted[index]
            const nativeResourceType = ResourceType.safeParse(resource.type)
            if (!nativeResourceType.success) {
              await refreshPanelSettings(resource)
              continue
            }
            await onEvent?.({
              type: MothershipStreamV1EventType.resource,
              payload: {
                op: MothershipStreamV1ResourceOp.remove,
                resource: {
                  type: nativeResourceType.data,
                  id: resource.id,
                  ...(resource.workspaceId ? { workspaceId: resource.workspaceId } : {}),
                  title: projected?.title ?? '',
                },
              },
            })
          }
        }
      }

      if (!isDeleteOp && !isAborted()) {
        const rawResources =
          result.resources && result.resources.length > 0
            ? result.resources
            : isResourceToolName(toolName)
              ? extractResourcesFromToolResult(toolName, params, result.output)
              : []
        const projectedResources =
          result.resources && result.resources.length > 0
            ? (projectedResult.resources ?? [])
            : isResourceToolName(toolName)
              ? extractResourcesFromToolResult(toolName, params, projectedResult.output)
              : []
        const resources =
          projectedResources.length === rawResources.length
            ? rawResources.map((resource, index) => ({
                ...projectedResources[index],
                type: resource.type,
                id: resource.id,
                ...((resource.workspaceId ?? workspaceId)
                  ? { workspaceId: resource.workspaceId ?? workspaceId }
                  : {}),
              }))
            : []

        if (resources.length > 0) {
          upsertedCount = resources.length
          logger.info('[file-stream-server] Emitting resource upsert events', {
            toolName,
            chatId,
            resources: resources.map((r) => ({ type: r.type, id: r.id, title: r.title })),
          })
          const upserts = resources.filter(
            (resource) => !('clearViewId' in resource && resource.clearViewId === true)
          )
          const persistence = persistChatResources(chatId, upserts).catch((err) => {
            logger.warn('Failed to persist chat resources', {
              chatId,
              error: toError(err).message,
            })
          })
          if (upserts.some((resource) => PANEL_SETTINGS_SECTIONS[resource.type])) await persistence

          for (const resource of resources) {
            if (isAborted()) break
            if ('clearViewId' in resource && resource.clearViewId === true) {
              const viewId = toRecord(params?.args).viewId
              if (resource.type !== 'table' || typeof viewId !== 'string' || !viewId.trim()) {
                throw new Error('Clearing a saved table view requires its deleted view ID')
              }
              await changeStoredChatResources(chatId, {
                kind: 'clear-view',
                tableId: resource.id,
                viewId,
                ...(resource.workspaceId ? { workspaceId: resource.workspaceId } : {}),
              })
              await onEvent?.({
                type: MothershipStreamV1EventType.resource,
                payload: {
                  op: 'clear_view',
                  resource: {
                    type: 'table',
                    id: resource.id,
                    viewId,
                    ...(resource.workspaceId ? { workspaceId: resource.workspaceId } : {}),
                  },
                },
              })
              continue
            }
            const nativeResourceType = ResourceType.safeParse(resource.type)
            if (!nativeResourceType.success) {
              await refreshPanelSettings(resource)
              continue
            }
            await onEvent?.({
              type: MothershipStreamV1EventType.resource,
              payload: {
                op: MothershipStreamV1ResourceOp.upsert,
                resource: { ...resource, type: nativeResourceType.data },
                ...(toolName === 'search_workspace' && resource.type === 'search'
                  ? {
                      searchResult: searchResultFromToolResult(projectedResult.output, actorUserId),
                    }
                  : {}),
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
