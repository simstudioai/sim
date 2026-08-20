import { toRecord } from '@sim/utils/object'
import {
  CreateEmptyFile,
  CreateWorkflow,
  DownloadFile,
  EditWorkflow,
  Ffmpeg,
  GenerateAudio,
  GenerateImage,
  GenerateVideo,
  Knowledge,
  ManageKnowledgeBase,
  PrepareFileEdit,
  Rm,
  RunFunction,
  UserTable,
} from '@/lib/copilot/generated/tool-catalog-v1'
import type { MothershipResource, MothershipResourceType } from './types'

type ChatResource = MothershipResource
type ResourceType = MothershipResourceType

const RESOURCE_TOOL_NAMES: Set<string> = new Set([
  UserTable.id,
  CreateEmptyFile.id,
  PrepareFileEdit.id,
  DownloadFile.id,
  CreateWorkflow.id,
  EditWorkflow.id,
  RunFunction.id,
  ManageKnowledgeBase.id,
  Knowledge.id,
  GenerateImage.id,
  GenerateVideo.id,
  GenerateAudio.id,
  Ffmpeg.id,
])

export function isResourceToolName(toolName: string): boolean {
  return RESOURCE_TOOL_NAMES.has(toolName)
}

function getOperation(params: Record<string, unknown> | undefined): string | undefined {
  const args = toRecord(params?.args)
  return (args.operation ?? params?.operation) as string | undefined
}

function getWorkspaceFileTarget(
  params: Record<string, unknown> | undefined
): Record<string, unknown> {
  return toRecord(params?.target)
}

const READ_ONLY_TABLE_OPS = new Set(['get', 'get_schema', 'get_row', 'query_rows'])
const READ_ONLY_KB_OPS = new Set(['get', 'query', 'list_tags', 'get_tag_usage'])
const READ_ONLY_KNOWLEDGE_ACTIONS = new Set(['listed', 'queried'])

/**
 * Extracts resource descriptors from a tool execution result.
 * Returns one or more resources for tools that create/modify workspace entities.
 * Read-only operations are excluded to avoid unnecessary cache invalidation.
 */
export function extractResourcesFromToolResult(
  toolName: string,
  params: Record<string, unknown> | undefined,
  output: unknown
): ChatResource[] {
  if (!isResourceToolName(toolName)) return []

  const result = toRecord(output)
  const data = toRecord(result.data)

  switch (toolName) {
    case UserTable.id: {
      if (READ_ONLY_TABLE_OPS.has(getOperation(params) ?? '')) return []

      if (result.tableId) {
        return [
          {
            type: 'table',
            id: result.tableId as string,
            title: (result.tableName as string) || 'Table',
          },
        ]
      }
      if (result.fileId) {
        return [
          {
            type: 'file',
            id: result.fileId as string,
            title: (result.fileName as string) || 'File',
          },
        ]
      }
      const table = toRecord(data.table)
      if (table.id) {
        return [{ type: 'table', id: table.id as string, title: (table.name as string) || 'Table' }]
      }
      const args = toRecord(params?.args)
      const tableId =
        (data.tableId as string) ?? (args.tableId as string) ?? (params?.tableId as string)
      if (tableId) {
        return [
          { type: 'table', id: tableId as string, title: (data.tableName as string) || 'Table' },
        ]
      }
      return []
    }

    case CreateEmptyFile.id:
    case PrepareFileEdit.id: {
      const file = toRecord(data.file)
      if (file.id) {
        return [{ type: 'file', id: file.id as string, title: (file.name as string) || 'File' }]
      }
      const fileId = (data.fileId as string) ?? (data.id as string)
      if (fileId) {
        const fileName = (data.fileName as string) || (data.name as string) || 'File'
        return [{ type: 'file', id: fileId, title: fileName }]
      }
      return []
    }

    case RunFunction.id: {
      if (result.tableId) {
        return [
          {
            type: 'table',
            id: result.tableId as string,
            title: (result.tableName as string) || 'Table',
          },
        ]
      }
      if (result.fileId) {
        return [
          {
            type: 'file',
            id: result.fileId as string,
            title: (result.fileName as string) || 'File',
          },
        ]
      }
      return []
    }

    case DownloadFile.id:
    case GenerateImage.id:
    case GenerateVideo.id:
    case GenerateAudio.id:
    case Ffmpeg.id: {
      // ffmpeg's probe op writes no file (no fileId) → no resource/auto-open.
      if (result.fileId) {
        return [
          {
            type: 'file',
            id: result.fileId as string,
            title: (result.fileName as string) || 'Generated File',
          },
        ]
      }
      return []
    }

    case CreateWorkflow.id:
    case EditWorkflow.id: {
      const workflowId =
        (result.workflowId as string) ??
        (data.workflowId as string) ??
        (params?.workflowId as string)
      if (workflowId) {
        const workflowName =
          (result.workflowName as string) ??
          (data.workflowName as string) ??
          (params?.workflowName as string) ??
          'Workflow'
        return [{ type: 'workflow', id: workflowId, title: workflowName }]
      }
      return []
    }

    case ManageKnowledgeBase.id: {
      if (READ_ONLY_KB_OPS.has(getOperation(params) ?? '')) return []

      const args = toRecord(params?.args)
      const kbId =
        (args.knowledgeBaseId as string) ??
        (params?.knowledgeBaseId as string) ??
        (result.knowledgeBaseId as string) ??
        (data.knowledgeBaseId as string) ??
        (data.id as string)
      if (kbId) {
        const kbName =
          (data.name as string) ?? (result.knowledgeBaseName as string) ?? 'Knowledge Base'
        return [{ type: 'knowledgebase', id: kbId, title: kbName }]
      }
      return []
    }

    case Knowledge.id: {
      const action = data.action as string | undefined
      if (READ_ONLY_KNOWLEDGE_ACTIONS.has(action ?? '')) return []

      const kbArray = data.knowledge_bases as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(kbArray)) return []
      const resources: ChatResource[] = []
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

    default:
      return []
  }
}

const DELETE_CAPABLE_TOOL_RESOURCE_TYPE: Record<string, ResourceType> = {
  [PrepareFileEdit.id]: 'file',
  [UserTable.id]: 'table',
  [ManageKnowledgeBase.id]: 'knowledgebase',
  // rm spans categories, so unlike every other entry its resource type comes
  // from each outcome's kind rather than from this map. The entry exists so
  // hasDeleteCapability(rm) holds; the rm case below ignores this value.
  [Rm.id]: 'file',
}

/** rm reports what it deleted per path; map that kind to the type the UI tracks. */
const RM_KIND_RESOURCE_TYPE: Record<string, ResourceType> = {
  file: 'file',
  file_folder: 'filefolder',
  workflow: 'workflow',
  workflow_folder: 'folder',
  table: 'table',
  manage_knowledge_base: 'knowledgebase',
}

export function hasDeleteCapability(toolName: string): boolean {
  return toolName in DELETE_CAPABLE_TOOL_RESOURCE_TYPE
}

/**
 * Extracts resource descriptors from a tool execution result when the tool
 * performed a deletion. Returns one or more deleted resources for tools that
 * destroy workspace entities.
 */
export function extractDeletedResourcesFromToolResult(
  toolName: string,
  params: Record<string, unknown> | undefined,
  output: unknown
): ChatResource[] {
  const resourceType = DELETE_CAPABLE_TOOL_RESOURCE_TYPE[toolName]
  if (!resourceType) return []

  const result = toRecord(output)
  const data = toRecord(result.data)
  const args = toRecord(params?.args)
  const operation = (args.operation ?? params?.operation) as string | undefined

  switch (toolName) {
    case Rm.id: {
      const outcomes = Array.isArray(result.results) ? result.results : []
      return outcomes.flatMap((entry): ChatResource[] => {
        const outcome = toRecord(entry)
        if (outcome.error) return []
        const { id, kind, from } = outcome
        if (typeof id !== 'string' || !id || typeof kind !== 'string') return []
        const type = RM_KIND_RESOURCE_TYPE[kind]
        if (!type) return []
        const path = typeof from === 'string' ? from : ''
        const leaf = path.split('/').filter(Boolean).pop() ?? ''
        return [{ type, id, title: leaf ? decodeURIComponent(leaf) : 'Deleted resource' }]
      })
    }
    case PrepareFileEdit.id: {
      if (operation !== 'delete') return []
      const target = getWorkspaceFileTarget(params)
      const fileId = (data.id as string) ?? (target.fileId as string) ?? (args.fileId as string)
      if (fileId) {
        return [{ type: resourceType, id: fileId, title: (data.name as string) || 'File' }]
      }
      return []
    }

    case UserTable.id: {
      if (operation !== 'delete') return []
      const deleted = Array.isArray(data.deleted)
        ? data.deleted.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : []
      if (deleted.length > 0) {
        return deleted.map((id) => ({ type: resourceType, id, title: 'Table' }))
      }
      const tableId = (args.tableId as string) ?? (params?.tableId as string)
      if (tableId) {
        return [{ type: resourceType, id: tableId, title: 'Table' }]
      }
      return []
    }

    case ManageKnowledgeBase.id: {
      if (operation !== 'delete') return []
      const deleted = Array.isArray(data.deleted) ? data.deleted : []
      const resources = deleted.flatMap((entry): ChatResource[] => {
        const deletedKnowledgeBase = toRecord(entry)
        const knowledgeBaseId = deletedKnowledgeBase.id
        if (typeof knowledgeBaseId !== 'string' || !knowledgeBaseId) return []
        return [
          {
            type: resourceType,
            id: knowledgeBaseId,
            title:
              typeof deletedKnowledgeBase.name === 'string'
                ? deletedKnowledgeBase.name
                : 'Knowledge Base',
          },
        ]
      })
      if (resources.length > 0) return resources
      const kbId = (data.id as string) ?? (args.knowledgeBaseId as string)
      if (kbId) {
        return [{ type: resourceType, id: kbId, title: (data.name as string) || 'Knowledge Base' }]
      }
      return []
    }

    default:
      return []
  }
}
