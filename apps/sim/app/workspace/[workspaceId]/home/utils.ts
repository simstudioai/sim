import type { TaskStoredMessage } from '@/hooks/queries/tasks'
import type { MothershipResource, SSEPayload } from './types'

export const RESOURCE_TOOL_NAMES = new Set([
  'user_table',
  'workspace_file',
  'create_workflow',
  'edit_workflow',
  'function_execute',
  'read',
  'knowledge_base',
  'knowledge',
])

/**
 * Resolves the top-level result object from an SSE payload.
 * The result may arrive at `parsed.result` or nested under `parsed.data.result`.
 */
function getTopResult(parsed: SSEPayload): Record<string, unknown> | undefined {
  return (parsed.result ?? (typeof parsed.data === 'object' ? parsed.data?.result : undefined)) as
    | Record<string, unknown>
    | undefined
}

function getResultData(parsed: SSEPayload): Record<string, unknown> | undefined {
  const result = getTopResult(parsed)
  return result?.data as Record<string, unknown> | undefined
}

export function extractTableResource(
  parsed: SSEPayload,
  storedArgs: Record<string, unknown> | undefined,
  fallbackTableId: string | null
): MothershipResource | null {
  const data = getResultData(parsed)
  const storedInnerArgs = storedArgs?.args as Record<string, unknown> | undefined

  const table = data?.table as Record<string, unknown> | undefined
  if (table?.id) {
    return { type: 'table', id: table.id as string, title: (table.name as string) || 'Table' }
  }

  const tableId =
    (data?.tableId as string) ?? storedInnerArgs?.tableId ?? storedArgs?.tableId ?? fallbackTableId
  const tableName = (data?.tableName as string) || (table?.name as string) || 'Table'
  if (tableId) return { type: 'table', id: tableId as string, title: tableName }

  return null
}

export function extractFileResource(
  parsed: SSEPayload,
  storedArgs: Record<string, unknown> | undefined
): MothershipResource | null {
  const data = getResultData(parsed)
  const storedInnerArgs = storedArgs?.args as Record<string, unknown> | undefined

  const file = data?.file as Record<string, unknown> | undefined
  if (file?.id) {
    return { type: 'file', id: file.id as string, title: (file.name as string) || 'File' }
  }

  const fileId = (data?.fileId as string) ?? (data?.id as string)
  const fileName =
    (data?.fileName as string) ||
    (data?.name as string) ||
    (storedInnerArgs?.fileName as string) ||
    'File'
  if (fileId && typeof fileId === 'string') return { type: 'file', id: fileId, title: fileName }

  return null
}

export function extractFunctionExecuteResource(
  parsed: SSEPayload,
  storedArgs: Record<string, unknown> | undefined
): MothershipResource | null {
  const topResult = getTopResult(parsed)

  if (topResult?.tableId) {
    return {
      type: 'table',
      id: topResult.tableId as string,
      title: (topResult.tableName as string) || 'Table',
    }
  }

  if (topResult?.fileId) {
    return {
      type: 'file',
      id: topResult.fileId as string,
      title: (topResult.fileName as string) || 'File',
    }
  }

  return null
}

export function extractWorkflowResource(
  parsed: SSEPayload,
  fallbackWorkflowId: string | null
): MothershipResource | null {
  const topResult = getTopResult(parsed)
  const data = topResult?.data as Record<string, unknown> | undefined

  const workflowId =
    (topResult?.workflowId as string) ?? (data?.workflowId as string) ?? fallbackWorkflowId
  const workflowName =
    (topResult?.workflowName as string) ?? (data?.workflowName as string) ?? 'Workflow'

  if (workflowId) return { type: 'workflow', id: workflowId, title: workflowName }

  return null
}

export function extractKnowledgeBaseResource(
  parsed: SSEPayload,
  storedArgs: Record<string, unknown> | undefined
): MothershipResource | null {
  const topResult = getTopResult(parsed)
  const data = topResult?.data as Record<string, unknown> | undefined

  const knowledgeBaseId =
    (data?.id as string) ??
    (topResult?.knowledgeBaseId as string) ??
    (data?.knowledgeBaseId as string) ??
    (storedArgs?.knowledgeBaseId as string)
  const knowledgeBaseName =
    (data?.name as string) ?? (topResult?.knowledgeBaseName as string) ?? 'Knowledge Base'

  if (knowledgeBaseId) {
    return { type: 'knowledgebase', id: knowledgeBaseId, title: knowledgeBaseName }
  }

  return null
}

/**
 * Extracts knowledge base resources from a `knowledge` subagent respond result.
 * The Go `knowledge_respond` tool returns a `knowledge_bases` array with `{id, name}` entries.
 */
export function extractKnowledgeRespondResources(parsed: SSEPayload): MothershipResource[] {
  const topResult = getTopResult(parsed)
  const data = topResult?.data as Record<string, unknown> | undefined
  const kbArray = data?.knowledge_bases as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(kbArray)) return []

  const resources: MothershipResource[] = []
  for (const kb of kbArray) {
    const id = kb.id as string | undefined
    if (id) {
      resources.push({
        type: 'knowledgebase',
        id,
        title: (kb.name as string) || 'Knowledge Base',
      })
    }
  }
  return resources
}

export const GENERIC_TITLES = new Set(['Table', 'File', 'Workflow', 'Knowledge Base'])

/**
 * Reconstructs the MothershipResource list from persisted tool calls.
 * Adapts each stored tool call into an SSEPayload so the existing
 * extract*Resource functions are reused with zero duplication.
 * Deduplicates by type+id while preserving insertion order.
 */
export function extractResourcesFromHistory(messages: TaskStoredMessage[]): MothershipResource[] {
  const resourceMap = new Map<string, MothershipResource>()
  let lastTableId: string | null = null
  let lastWorkflowId: string | null = null

  for (const msg of messages) {
    if (!msg.toolCalls) continue

    for (const tc of msg.toolCalls) {
      if (tc.status !== 'success' || !RESOURCE_TOOL_NAMES.has(tc.name)) continue

      const payload: SSEPayload = {
        type: 'tool_result',
        result: tc.result as Record<string, unknown>,
        success: true,
        toolName: tc.name,
      }
      const args = tc.params as Record<string, unknown> | undefined

      let resource: MothershipResource | null = null
      if (tc.name === 'user_table') {
        const redirected = extractFunctionExecuteResource(payload, args)
        if (redirected?.type === 'file') {
          resource = redirected
        } else {
          resource = extractTableResource(payload, args, lastTableId)
          if (resource) lastTableId = resource.id
        }
      } else if (tc.name === 'workspace_file') {
        resource = extractFileResource(payload, args)
      } else if (tc.name === 'function_execute') {
        resource = extractFunctionExecuteResource(payload, args)
        if (resource?.type === 'table') lastTableId = resource.id
      } else if (tc.name === 'read') {
        resource = extractFunctionExecuteResource(payload, args)
        if (resource?.type === 'table') lastTableId = resource.id
      } else if (tc.name === 'create_workflow' || tc.name === 'edit_workflow') {
        resource = extractWorkflowResource(payload, lastWorkflowId)
        if (resource) lastWorkflowId = resource.id
      } else if (tc.name === 'knowledge_base') {
        resource = extractKnowledgeBaseResource(payload, args)
      } else if (tc.name === 'knowledge') {
        const kbResources = extractKnowledgeRespondResources(payload)
        for (const r of kbResources) {
          const key = `${r.type}:${r.id}`
          const existing = resourceMap.get(key)
          if (!existing || (GENERIC_TITLES.has(existing.title) && !GENERIC_TITLES.has(r.title))) {
            resourceMap.set(key, r)
          }
        }
      }

      if (resource) {
        const key = `${resource.type}:${resource.id}`
        const existing = resourceMap.get(key)
        if (
          !existing ||
          (GENERIC_TITLES.has(existing.title) && !GENERIC_TITLES.has(resource.title))
        ) {
          resourceMap.set(key, resource)
        }
      }
    }
  }

  return Array.from(resourceMap.values())
}
