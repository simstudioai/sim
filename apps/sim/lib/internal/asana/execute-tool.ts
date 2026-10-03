import { getErrorMessage } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import {
  asanaAddCommentContract,
  asanaAddFollowersContract,
  asanaCreateProjectContract,
  asanaCreateSectionContract,
  asanaCreateSubtaskContract,
  asanaCreateTaskContract,
  asanaDeleteTaskContract,
  asanaGetProjectContract,
  asanaGetProjectsContract,
  asanaGetTaskContract,
  asanaListSectionsContract,
  asanaListWorkspacesContract,
  asanaSearchTasksContract,
  asanaUpdateTaskContract,
} from '@/lib/api/contracts/tools/asana'
import { AsanaOperationError } from '@/lib/internal/asana/errors'
import {
  executeAsanaAddComment,
  executeAsanaAddFollowers,
  executeAsanaCreateProject,
  executeAsanaCreateSection,
  executeAsanaCreateSubtask,
  executeAsanaCreateTask,
  executeAsanaDeleteTask,
  executeAsanaGetProject,
  executeAsanaGetProjects,
  executeAsanaGetTask,
  executeAsanaListSections,
  executeAsanaListWorkspaces,
  executeAsanaSearchTasks,
  executeAsanaUpdateTask,
} from '@/lib/internal/asana/operations'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'

type UnexpectedErrorPolicy = { kind: 'dynamic' } | { kind: 'fixed'; message: string }

function unexpectedErrorBody(
  error: unknown,
  policy: UnexpectedErrorPolicy
): Record<string, unknown> {
  if (policy.kind === 'dynamic') {
    return { error: getErrorMessage(error, 'Internal server error'), success: false }
  }
  return {
    error: policy.message,
    details: getErrorMessage(error, '') || undefined,
  }
}

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  request: InternalToolOperationCall,
  execute: (input: ContractBody<C>, signal?: AbortSignal) => Promise<unknown>,
  unexpectedErrorPolicy: UnexpectedErrorPolicy
): Promise<Response> {
  request.signal?.throwIfAborted()
  if (!contract.body) throw new Error(`Asana contract ${contract.path} has no operation input`)
  const parsed = contract.body.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request data', details: parsed.error.issues },
      { status: 400 }
    )
  }

  try {
    const result = await execute(parsed.data as ContractBody<C>, request.signal)
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof AsanaOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    return Response.json(unexpectedErrorBody(error, unexpectedErrorPolicy), { status: 500 })
  }
}

const DYNAMIC_ERROR = { kind: 'dynamic' } as const

export const executeAsanaTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!request.context.userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  switch (request.toolId) {
    case 'asana_add_comment':
      return executeOperation(asanaAddCommentContract, request, executeAsanaAddComment, {
        kind: 'fixed',
        message: 'Failed to add comment to Asana task',
      })
    case 'asana_add_followers':
      return executeOperation(asanaAddFollowersContract, request, executeAsanaAddFollowers, {
        kind: 'fixed',
        message: 'Failed to add followers to Asana task',
      })
    case 'asana_create_project':
      return executeOperation(
        asanaCreateProjectContract,
        request,
        executeAsanaCreateProject,
        DYNAMIC_ERROR
      )
    case 'asana_create_section':
      return executeOperation(
        asanaCreateSectionContract,
        request,
        executeAsanaCreateSection,
        DYNAMIC_ERROR
      )
    case 'asana_create_subtask':
      return executeOperation(
        asanaCreateSubtaskContract,
        request,
        executeAsanaCreateSubtask,
        DYNAMIC_ERROR
      )
    case 'asana_create_task':
      return executeOperation(
        asanaCreateTaskContract,
        request,
        executeAsanaCreateTask,
        DYNAMIC_ERROR
      )
    case 'asana_delete_task':
      return executeOperation(asanaDeleteTaskContract, request, executeAsanaDeleteTask, {
        kind: 'fixed',
        message: 'Failed to delete Asana task',
      })
    case 'asana_get_project':
      return executeOperation(asanaGetProjectContract, request, executeAsanaGetProject, {
        kind: 'fixed',
        message: 'Failed to retrieve Asana project',
      })
    case 'asana_get_projects':
      return executeOperation(asanaGetProjectsContract, request, executeAsanaGetProjects, {
        kind: 'fixed',
        message: 'Failed to retrieve Asana projects',
      })
    case 'asana_get_task':
      return executeOperation(asanaGetTaskContract, request, executeAsanaGetTask, {
        kind: 'fixed',
        message: 'Failed to retrieve Asana task(s)',
      })
    case 'asana_list_sections':
      return executeOperation(asanaListSectionsContract, request, executeAsanaListSections, {
        kind: 'fixed',
        message: 'Failed to retrieve Asana sections',
      })
    case 'asana_list_workspaces':
      return executeOperation(asanaListWorkspacesContract, request, executeAsanaListWorkspaces, {
        kind: 'fixed',
        message: 'Failed to retrieve Asana workspaces',
      })
    case 'asana_search_tasks':
      return executeOperation(asanaSearchTasksContract, request, executeAsanaSearchTasks, {
        kind: 'fixed',
        message: 'Failed to search Asana tasks',
      })
    case 'asana_update_task':
      return executeOperation(
        asanaUpdateTaskContract,
        request,
        executeAsanaUpdateTask,
        DYNAMIC_ERROR
      )
    default:
      return Response.json({ error: `Unsupported Asana tool: ${request.toolId}` }, { status: 500 })
  }
}
