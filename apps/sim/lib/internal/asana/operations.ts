import type {
  AsanaAddCommentBody,
  AsanaAddFollowersBody,
  AsanaCreateProjectBody,
  AsanaCreateSectionBody,
  AsanaCreateSubtaskBody,
  AsanaCreateTaskBody,
  AsanaDeleteTaskBody,
  AsanaGetProjectBody,
  AsanaGetProjectsBody,
  AsanaGetTaskBody,
  AsanaListSectionsBody,
  AsanaListWorkspacesBody,
  AsanaSearchTasksBody,
  AsanaUpdateTaskBody,
} from '@/lib/api/contracts/tools/asana'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { AsanaClient, type AsanaJsonObject, asArray, asObject } from '@/lib/internal/asana/client'
import { AsanaOperationError } from '@/lib/internal/asana/errors'

const TASK_OPT_FIELDS =
  'gid,name,notes,completed,assignee,assignee.name,due_on,created_at,modified_at,created_by,created_by.name,resource_type,resource_subtype'
const PROJECT_OPT_FIELDS = 'name,notes,archived,color,created_at,modified_at,permalink_url'

function timestamp(): string {
  return new Date().toISOString()
}

function validateId(value: string, name: string): void {
  const validation = validateAlphanumericId(value, name, 100)
  if (!validation.isValid) {
    const error = validation.error || `Invalid ${name}`
    throw new AsanaOperationError(error, 400, { error })
  }
}

function dataObject(result: AsanaJsonObject): AsanaJsonObject {
  return asObject(result.data)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function requiredString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function taskSummary(value: unknown) {
  const task = asObject(value)
  const assignee = asObject(task.assignee)
  const createdBy = asObject(task.created_by)
  return {
    gid: requiredString(task.gid),
    resource_type: optionalString(task.resource_type),
    resource_subtype: optionalString(task.resource_subtype),
    name: requiredString(task.name),
    notes: requiredString(task.notes),
    completed: task.completed === true,
    assignee:
      Object.keys(assignee).length > 0
        ? { gid: requiredString(assignee.gid), name: requiredString(assignee.name) }
        : undefined,
    created_by:
      Object.keys(createdBy).length > 0
        ? {
            gid: requiredString(createdBy.gid),
            resource_type: optionalString(createdBy.resource_type),
            name: requiredString(createdBy.name),
          }
        : undefined,
    due_on: optionalString(task.due_on) || undefined,
    created_at: optionalString(task.created_at),
    modified_at: optionalString(task.modified_at),
  }
}

function taskMutation(task: AsanaJsonObject) {
  return {
    success: true as const,
    ts: timestamp(),
    gid: requiredString(task.gid),
    name: requiredString(task.name),
    notes: requiredString(task.notes),
    completed: task.completed === true,
    created_at: optionalString(task.created_at),
    modified_at: optionalString(task.modified_at),
    permalink_url: optionalString(task.permalink_url),
  }
}

function projectRecord(project: AsanaJsonObject) {
  return {
    success: true as const,
    ts: timestamp(),
    gid: requiredString(project.gid),
    name: requiredString(project.name),
    notes: requiredString(project.notes),
    archived: optionalBoolean(project.archived) ?? false,
    color: typeof project.color === 'string' ? project.color : null,
    created_at: optionalString(project.created_at),
    modified_at: optionalString(project.modified_at),
    permalink_url: optionalString(project.permalink_url),
  }
}

function jsonBody(data: Record<string, unknown>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  }
}

export async function executeAsanaAddComment(input: AsanaAddCommentBody, signal?: AbortSignal) {
  validateId(input.taskGid, 'taskGid')
  const result = await new AsanaClient(input.accessToken).json(
    `/tasks/${input.taskGid}/stories`,
    jsonBody({ text: input.text }),
    signal
  )
  const story = dataObject(result)
  const createdBy = asObject(story.created_by)
  return {
    success: true as const,
    ts: timestamp(),
    gid: requiredString(story.gid),
    text: requiredString(story.text),
    created_at: optionalString(story.created_at),
    created_by:
      Object.keys(createdBy).length > 0
        ? { gid: requiredString(createdBy.gid), name: requiredString(createdBy.name) }
        : undefined,
  }
}

export async function executeAsanaAddFollowers(input: AsanaAddFollowersBody, signal?: AbortSignal) {
  validateId(input.taskGid, 'taskGid')
  for (const follower of input.followers) validateId(follower, 'follower')
  const result = await new AsanaClient(input.accessToken).json(
    `/tasks/${input.taskGid}/addFollowers?opt_fields=name,followers.name`,
    jsonBody({ followers: input.followers }),
    signal
  )
  const task = dataObject(result)
  return {
    success: true as const,
    ts: timestamp(),
    gid: requiredString(task.gid),
    name: requiredString(task.name),
    followers: asArray(task.followers).map((value) => {
      const follower = asObject(value)
      return { gid: requiredString(follower.gid), name: requiredString(follower.name) }
    }),
  }
}

export async function executeAsanaCreateProject(
  input: AsanaCreateProjectBody,
  signal?: AbortSignal
) {
  validateId(input.workspace, 'workspace')
  const data: Record<string, unknown> = { name: input.name, workspace: input.workspace }
  if (input.notes) data.notes = input.notes
  const result = await new AsanaClient(input.accessToken).json(
    `/projects?opt_fields=${PROJECT_OPT_FIELDS}`,
    jsonBody(data),
    signal
  )
  return projectRecord(dataObject(result))
}

export async function executeAsanaCreateSection(
  input: AsanaCreateSectionBody,
  signal?: AbortSignal
) {
  validateId(input.projectGid, 'projectGid')
  const result = await new AsanaClient(input.accessToken).json(
    `/projects/${input.projectGid}/sections`,
    jsonBody({ name: input.name }),
    signal
  )
  const section = dataObject(result)
  return {
    success: true as const,
    ts: timestamp(),
    gid: requiredString(section.gid),
    name: requiredString(section.name),
    created_at: optionalString(section.created_at),
  }
}

export async function executeAsanaCreateSubtask(
  input: AsanaCreateSubtaskBody,
  signal?: AbortSignal
) {
  validateId(input.taskGid, 'taskGid')
  const data: Record<string, unknown> = { name: input.name }
  if (input.notes) data.notes = input.notes
  if (input.assignee) data.assignee = input.assignee
  if (input.due_on) data.due_on = input.due_on
  const result = await new AsanaClient(input.accessToken).json(
    `/tasks/${input.taskGid}/subtasks?opt_fields=name,notes,completed,created_at,permalink_url`,
    jsonBody(data),
    signal
  )
  return taskMutation(dataObject(result))
}

export async function executeAsanaCreateTask(input: AsanaCreateTaskBody, signal?: AbortSignal) {
  validateId(input.workspace, 'workspace')
  const data: Record<string, unknown> = { name: input.name, workspace: input.workspace }
  if (input.notes) data.notes = input.notes
  if (input.assignee) data.assignee = input.assignee
  if (input.due_on) data.due_on = input.due_on
  const result = await new AsanaClient(input.accessToken).json(
    '/tasks?opt_fields=name,notes,completed,created_at,permalink_url',
    jsonBody(data),
    signal
  )
  return taskMutation(dataObject(result))
}

export async function executeAsanaDeleteTask(input: AsanaDeleteTaskBody, signal?: AbortSignal) {
  validateId(input.taskGid, 'taskGid')
  await new AsanaClient(input.accessToken).empty(
    `/tasks/${input.taskGid}`,
    { method: 'DELETE' },
    signal
  )
  return { success: true as const, ts: timestamp(), gid: input.taskGid, deleted: true as const }
}

export async function executeAsanaGetProject(input: AsanaGetProjectBody, signal?: AbortSignal) {
  validateId(input.projectGid, 'projectGid')
  const result = await new AsanaClient(input.accessToken).json(
    `/projects/${input.projectGid}?opt_fields=${PROJECT_OPT_FIELDS}`,
    { method: 'GET' },
    signal
  )
  return projectRecord(dataObject(result))
}

export async function executeAsanaGetProjects(input: AsanaGetProjectsBody, signal?: AbortSignal) {
  validateId(input.workspace, 'workspace')
  const result = await new AsanaClient(input.accessToken).json(
    `/projects?workspace=${input.workspace}`,
    { method: 'GET' },
    signal
  )
  return {
    success: true as const,
    ts: timestamp(),
    projects: asArray(result.data).map((value) => {
      const project = asObject(value)
      return {
        gid: requiredString(project.gid),
        name: requiredString(project.name),
        resource_type: requiredString(project.resource_type),
      }
    }),
  }
}

export async function executeAsanaGetTask(input: AsanaGetTaskBody, signal?: AbortSignal) {
  const client = new AsanaClient(input.accessToken)
  if (input.taskGid) {
    validateId(input.taskGid, 'taskGid')
    const result = await client.json(
      `/tasks/${input.taskGid}?opt_fields=${TASK_OPT_FIELDS}`,
      { method: 'GET' },
      signal
    )
    return { success: true as const, ts: timestamp(), ...taskSummary(result.data) }
  }

  if (!input.workspace && !input.project) {
    const error = 'Either taskGid or workspace/project must be provided'
    throw new AsanaOperationError(error, 400, { error })
  }
  const params = new URLSearchParams()
  if (input.project) {
    validateId(input.project, 'project')
    params.append('project', input.project)
  } else if (input.workspace) {
    validateId(input.workspace, 'workspace')
    params.append('workspace', input.workspace)
  }
  params.append('limit', input.limit ? String(input.limit) : '50')
  params.append('opt_fields', TASK_OPT_FIELDS)
  const result = await client.json(`/tasks?${params.toString()}`, { method: 'GET' }, signal)
  return {
    success: true as const,
    ts: timestamp(),
    tasks: asArray(result.data).map(taskSummary),
    next_page: result.next_page,
  }
}

export async function executeAsanaListSections(input: AsanaListSectionsBody, signal?: AbortSignal) {
  validateId(input.projectGid, 'projectGid')
  const result = await new AsanaClient(input.accessToken).json(
    `/projects/${input.projectGid}/sections`,
    { method: 'GET' },
    signal
  )
  return {
    success: true as const,
    ts: timestamp(),
    sections: asArray(result.data).map((value) => {
      const section = asObject(value)
      return {
        gid: requiredString(section.gid),
        name: requiredString(section.name),
        resource_type: optionalString(section.resource_type),
      }
    }),
  }
}

export async function executeAsanaListWorkspaces(
  input: AsanaListWorkspacesBody,
  signal?: AbortSignal
) {
  const result = await new AsanaClient(input.accessToken).json(
    '/workspaces?limit=100',
    { method: 'GET' },
    signal
  )
  return {
    success: true as const,
    ts: timestamp(),
    workspaces: asArray(result.data).map((value) => {
      const workspace = asObject(value)
      return {
        gid: requiredString(workspace.gid),
        name: requiredString(workspace.name),
        resource_type: optionalString(workspace.resource_type),
      }
    }),
  }
}

export async function executeAsanaSearchTasks(input: AsanaSearchTasksBody, signal?: AbortSignal) {
  validateId(input.workspace, 'workspace')
  const params = new URLSearchParams()
  if (input.text) params.append('text', input.text)
  if (input.assignee) params.append('assignee.any', input.assignee)
  if (input.projects?.length) params.append('projects.any', input.projects.join(','))
  if (input.completed !== undefined) {
    params.append('completed', String(input.completed))
  }
  params.append('opt_fields', TASK_OPT_FIELDS)
  const result = await new AsanaClient(input.accessToken).json(
    `/workspaces/${input.workspace}/tasks/search?${params.toString()}`,
    { method: 'GET' },
    signal
  )
  return {
    success: true as const,
    ts: timestamp(),
    tasks: asArray(result.data).map(taskSummary),
    next_page: result.next_page,
  }
}

export async function executeAsanaUpdateTask(input: AsanaUpdateTaskBody, signal?: AbortSignal) {
  validateId(input.taskGid, 'taskGid')
  const data: Record<string, unknown> = {}
  if (input.name !== undefined) data.name = input.name
  if (input.notes !== undefined) data.notes = input.notes
  if (input.assignee !== undefined) data.assignee = input.assignee
  if (input.completed !== undefined) data.completed = input.completed
  if (input.due_on !== undefined) data.due_on = input.due_on
  const result = await new AsanaClient(input.accessToken).json(
    `/tasks/${input.taskGid}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    },
    signal
  )
  return taskMutation(dataObject(result))
}
