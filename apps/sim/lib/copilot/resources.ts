import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'

const logger = createLogger('CopilotResources')

export type ResourceType = 'table' | 'file' | 'workflow' | 'knowledgebase'

export interface ChatResource {
  type: ResourceType
  id: string
  title: string
}

const RESOURCE_TOOL_NAMES = new Set([
  'user_table',
  'workspace_file',
  'create_workflow',
  'edit_workflow',
  'function_execute',
  'read',
  'knowledge_base',
  'knowledge',
])

export function isResourceToolName(toolName: string): boolean {
  return RESOURCE_TOOL_NAMES.has(toolName)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/**
 * Extracts resource descriptors from a tool execution result.
 * Returns one or more resources for tools that create/modify workspace entities.
 */
export function extractResourcesFromToolResult(
  toolName: string,
  params: Record<string, unknown> | undefined,
  output: unknown
): ChatResource[] {
  if (!isResourceToolName(toolName)) return []

  const result = asRecord(output)
  const data = asRecord(result.data)

  switch (toolName) {
    case 'user_table': {
      if (result.tableId) {
        return [
          { type: 'table', id: result.tableId as string, title: (result.tableName as string) || 'Table' },
        ]
      }
      if (result.fileId) {
        return [
          { type: 'file', id: result.fileId as string, title: (result.fileName as string) || 'File' },
        ]
      }
      const table = asRecord(data.table)
      if (table.id) {
        return [
          { type: 'table', id: table.id as string, title: (table.name as string) || 'Table' },
        ]
      }
      const args = asRecord(params?.args)
      const tableId = (data.tableId as string) ?? (args.tableId as string) ?? (params?.tableId as string)
      if (tableId) {
        return [
          { type: 'table', id: tableId as string, title: (data.tableName as string) || 'Table' },
        ]
      }
      return []
    }

    case 'workspace_file': {
      const file = asRecord(data.file)
      if (file.id) {
        return [
          { type: 'file', id: file.id as string, title: (file.name as string) || 'File' },
        ]
      }
      const fileId = (data.fileId as string) ?? (data.id as string)
      if (fileId) {
        const fileName = (data.fileName as string) || (data.name as string) || 'File'
        return [{ type: 'file', id: fileId, title: fileName }]
      }
      return []
    }

    case 'function_execute':
    case 'read': {
      if (result.tableId) {
        return [
          { type: 'table', id: result.tableId as string, title: (result.tableName as string) || 'Table' },
        ]
      }
      if (result.fileId) {
        return [
          { type: 'file', id: result.fileId as string, title: (result.fileName as string) || 'File' },
        ]
      }
      return []
    }

    case 'create_workflow':
    case 'edit_workflow': {
      const workflowId = (result.workflowId as string) ?? (data.workflowId as string) ?? (params?.workflowId as string)
      if (workflowId) {
        const workflowName =
          (result.workflowName as string) ?? (data.workflowName as string) ?? (params?.workflowName as string) ?? 'Workflow'
        return [{ type: 'workflow', id: workflowId, title: workflowName }]
      }
      return []
    }

    case 'knowledge_base': {
      const kbId =
        (data.id as string) ?? (result.knowledgeBaseId as string) ?? (data.knowledgeBaseId as string) ?? (params?.knowledgeBaseId as string)
      if (kbId) {
        const kbName = (data.name as string) ?? (result.knowledgeBaseName as string) ?? 'Knowledge Base'
        return [{ type: 'knowledgebase', id: kbId, title: kbName }]
      }
      return []
    }

    case 'knowledge': {
      const kbArray = data.knowledge_bases as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(kbArray)) return []
      const resources: ChatResource[] = []
      for (const kb of kbArray) {
        const id = kb.id as string | undefined
        if (id) {
          resources.push({ type: 'knowledgebase', id, title: (kb.name as string) || 'Knowledge Base' })
        }
      }
      return resources
    }

    default:
      return []
  }
}

/**
 * Appends resources to a chat's JSONB resources column, deduplicating by type+id.
 * Updates the title of existing resources if the new title is more specific.
 */
export async function persistChatResources(chatId: string, newResources: ChatResource[]): Promise<void> {
  if (newResources.length === 0) return

  try {
    const [chat] = await db
      .select({ resources: copilotChats.resources })
      .from(copilotChats)
      .where(eq(copilotChats.id, chatId))
      .limit(1)

    if (!chat) return

    const existing = Array.isArray(chat.resources) ? (chat.resources as ChatResource[]) : []
    const map = new Map<string, ChatResource>()
    const GENERIC = new Set(['Table', 'File', 'Workflow', 'Knowledge Base'])

    for (const r of existing) {
      map.set(`${r.type}:${r.id}`, r)
    }

    for (const r of newResources) {
      const key = `${r.type}:${r.id}`
      const prev = map.get(key)
      if (!prev || (GENERIC.has(prev.title) && !GENERIC.has(r.title))) {
        map.set(key, r)
      }
    }

    const merged = Array.from(map.values())

    await db
      .update(copilotChats)
      .set({ resources: sql`${JSON.stringify(merged)}::jsonb` })
      .where(eq(copilotChats.id, chatId))
  } catch (err) {
    logger.warn('Failed to persist chat resources', {
      chatId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
