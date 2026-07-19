import {
  CreateFile,
  CreateWorkflow,
  DeleteFile,
  DeleteFileFolder,
  DeleteWorkflow,
  DownloadToWorkspaceFile,
  EditWorkflow,
  Ffmpeg,
  FunctionExecute,
  GenerateAudio,
  GenerateImage,
  GenerateVideo,
  Knowledge,
  KnowledgeBase,
  ManageFolder,
  ManageScheduledTask,
  UserInterface,
  UserTable,
  WorkspaceFile,
} from '@/lib/copilot/generated/tool-catalog-v1'
import type { MothershipResource, MothershipResourceType } from './types'

type ChatResource = MothershipResource
type ResourceType = MothershipResourceType

const RESOURCE_TOOL_NAMES: Set<string> = new Set([
  UserTable.id,
  UserInterface.id,
  CreateFile.id,
  WorkspaceFile.id,
  DownloadToWorkspaceFile.id,
  CreateWorkflow.id,
  EditWorkflow.id,
  FunctionExecute.id,
  KnowledgeBase.id,
  Knowledge.id,
  ManageScheduledTask.id,
  GenerateImage.id,
  GenerateVideo.id,
  GenerateAudio.id,
  Ffmpeg.id,
])

export function isResourceToolName(toolName: string): boolean {
  return RESOURCE_TOOL_NAMES.has(toolName)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function getOperation(params: Record<string, unknown> | undefined): string | undefined {
  const args = asRecord(params?.args)
  return (args.operation ?? params?.operation) as string | undefined
}

function getWorkspaceFileTarget(
  params: Record<string, unknown> | undefined
): Record<string, unknown> {
  return asRecord(params?.target)
}

const READ_ONLY_TABLE_OPS = new Set(['get', 'get_schema', 'get_row', 'query_rows'])
const READ_ONLY_INTERFACE_OPS = new Set(['get', 'list'])
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

  const result = asRecord(output)
  const data = asRecord(result.data)

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
      const table = asRecord(data.table)
      if (table.id) {
        return [{ type: 'table', id: table.id as string, title: (table.name as string) || 'Table' }]
      }
      const args = asRecord(params?.args)
      const tableId =
        (data.tableId as string) ?? (args.tableId as string) ?? (params?.tableId as string)
      if (tableId) {
        return [
          { type: 'table', id: tableId as string, title: (data.tableName as string) || 'Table' },
        ]
      }
      return []
    }

    case UserInterface.id: {
      if (READ_ONLY_INTERFACE_OPS.has(getOperation(params) ?? '')) return []

      const definition = asRecord(data.interface)
      if (definition.id) {
        return [
          {
            type: 'interface',
            id: definition.id as string,
            title: (definition.name as string) || 'Interface',
          },
        ]
      }
      const args = asRecord(params?.args)
      const interfaceId = (data.interfaceId as string) ?? (args.interfaceId as string)
      if (interfaceId) {
        return [{ type: 'interface', id: interfaceId, title: (data.name as string) || 'Interface' }]
      }
      return []
    }

    case CreateFile.id:
    case WorkspaceFile.id: {
      const file = asRecord(data.file)
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

    case FunctionExecute.id: {
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

    case DownloadToWorkspaceFile.id:
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

    case KnowledgeBase.id: {
      if (READ_ONLY_KB_OPS.has(getOperation(params) ?? '')) return []

      const args = asRecord(params?.args)
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

    case ManageScheduledTask.id: {
      // Read-only ops never auto-open; only create/update surface the task.
      const op = getOperation(params)
      if (op === 'list' || op === 'get') return []
      const jobId = (result.jobId as string) ?? (data.jobId as string)
      if (jobId) {
        const args = asRecord(params?.args)
        const title = (result.title as string) ?? (args.title as string) ?? 'Scheduled Task'
        return [{ type: 'scheduledtask', id: jobId, title }]
      }
      return []
    }

    default:
      return []
  }
}

const DELETE_CAPABLE_TOOL_RESOURCE_TYPE: Record<string, ResourceType> = {
  [DeleteWorkflow.id]: 'workflow',
  [DeleteFile.id]: 'file',
  [DeleteFileFolder.id]: 'filefolder',
  [WorkspaceFile.id]: 'file',
  [UserTable.id]: 'table',
  [UserInterface.id]: 'interface',
  [KnowledgeBase.id]: 'knowledgebase',
  [ManageFolder.id]: 'folder',
  [ManageScheduledTask.id]: 'scheduledtask',
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

  const result = asRecord(output)
  const data = asRecord(result.data)
  const args = asRecord(params?.args)
  const operation = (args.operation ?? params?.operation) as string | undefined

  switch (toolName) {
    case DeleteWorkflow.id: {
      const deleted = Array.isArray(result.deleted) ? result.deleted : []
      const resources = deleted.flatMap((entry): ChatResource[] => {
        const deletedWorkflow = asRecord(entry)
        const workflowId = deletedWorkflow.workflowId
        if (typeof workflowId !== 'string' || !workflowId) return []
        return [
          {
            type: resourceType,
            id: workflowId,
            title: typeof deletedWorkflow.name === 'string' ? deletedWorkflow.name : 'Workflow',
          },
        ]
      })
      if (resources.length > 0) return resources

      // Backward compatibility for historical single-workflow tool results.
      const workflowId = (result.workflowId as string) ?? (params?.workflowId as string)
      if (workflowId && result.deleted === true) {
        return [
          { type: resourceType, id: workflowId, title: (result.name as string) || 'Workflow' },
        ]
      }
      return []
    }

    case DeleteFile.id: {
      const deleted = Array.isArray(data.deleted) ? data.deleted : []
      return deleted.flatMap((entry): ChatResource[] => {
        const deletedFile = asRecord(entry)
        const fileId = deletedFile.id
        if (typeof fileId !== 'string' || !fileId) return []
        return [
          {
            type: resourceType,
            id: fileId,
            title: typeof deletedFile.name === 'string' ? deletedFile.name : 'File',
          },
        ]
      })
    }

    case DeleteFileFolder.id: {
      const deletedFolderIds = Array.isArray(data.deletedFolderIds)
        ? data.deletedFolderIds.filter(
            (id): id is string => typeof id === 'string' && id.length > 0
          )
        : []
      return deletedFolderIds.map((id) => ({ type: resourceType, id, title: 'Folder' }))
    }

    case WorkspaceFile.id: {
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

    case UserInterface.id: {
      if (operation !== 'delete') return []
      const interfaceId = (data.interfaceId as string) ?? (args.interfaceId as string)
      if (interfaceId) {
        return [
          { type: resourceType, id: interfaceId, title: (data.name as string) || 'Interface' },
        ]
      }
      return []
    }

    case KnowledgeBase.id: {
      if (operation !== 'delete') return []
      const deleted = Array.isArray(data.deleted) ? data.deleted : []
      const resources = deleted.flatMap((entry): ChatResource[] => {
        const deletedKnowledgeBase = asRecord(entry)
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

    case ManageFolder.id: {
      if (operation !== 'delete') return []
      const deletedIds = Array.isArray(result.deleted) ? (result.deleted as unknown[]) : []
      return deletedIds.flatMap((id): ChatResource[] =>
        typeof id === 'string' && id ? [{ type: resourceType, id, title: 'Folder' }] : []
      )
    }

    case ManageScheduledTask.id: {
      if (operation !== 'delete') return []
      const deletedIds = Array.isArray(result.deleted) ? (result.deleted as string[]) : []
      return deletedIds.map((id) => ({ type: resourceType, id, title: 'Scheduled Task' }))
    }

    default:
      return []
  }
}
