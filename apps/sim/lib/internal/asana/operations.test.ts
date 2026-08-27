/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

const API_BASE_URL = 'https://app.asana.com/api/1.0'
const TASK_OPT_FIELDS =
  'gid,name,notes,completed,assignee,assignee.name,due_on,created_at,modified_at,created_by,created_by.name,resource_type,resource_subtype'
const PROJECT_OPT_FIELDS = 'name,notes,archived,color,created_at,modified_at,permalink_url'
const AUTH = { accessToken: 'access-token' }

describe('Asana operations', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ data: {}, next_page: { offset: 'next' } }))
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const searchParams = new URLSearchParams({ opt_fields: TASK_OPT_FIELDS })
  const operationCases = [
    {
      name: 'add comment',
      run: (signal: AbortSignal) =>
        executeAsanaAddComment({ ...AUTH, taskGid: 'task1', text: 'Comment' }, signal),
      url: `${API_BASE_URL}/tasks/task1/stories`,
      method: 'POST',
    },
    {
      name: 'add followers',
      run: (signal: AbortSignal) =>
        executeAsanaAddFollowers({ ...AUTH, taskGid: 'task1', followers: ['user1'] }, signal),
      url: `${API_BASE_URL}/tasks/task1/addFollowers?opt_fields=name,followers.name`,
      method: 'POST',
    },
    {
      name: 'create project',
      run: (signal: AbortSignal) =>
        executeAsanaCreateProject({ ...AUTH, workspace: 'workspace1', name: 'Project' }, signal),
      url: `${API_BASE_URL}/projects?opt_fields=${PROJECT_OPT_FIELDS}`,
      method: 'POST',
    },
    {
      name: 'create section',
      run: (signal: AbortSignal) =>
        executeAsanaCreateSection({ ...AUTH, projectGid: 'project1', name: 'Section' }, signal),
      url: `${API_BASE_URL}/projects/project1/sections`,
      method: 'POST',
    },
    {
      name: 'create subtask',
      run: (signal: AbortSignal) =>
        executeAsanaCreateSubtask({ ...AUTH, taskGid: 'task1', name: 'Subtask' }, signal),
      url: `${API_BASE_URL}/tasks/task1/subtasks?opt_fields=name,notes,completed,created_at,permalink_url`,
      method: 'POST',
    },
    {
      name: 'create task',
      run: (signal: AbortSignal) =>
        executeAsanaCreateTask({ ...AUTH, workspace: 'workspace1', name: 'Task' }, signal),
      url: `${API_BASE_URL}/tasks?opt_fields=name,notes,completed,created_at,permalink_url`,
      method: 'POST',
    },
    {
      name: 'delete task',
      run: (signal: AbortSignal) => executeAsanaDeleteTask({ ...AUTH, taskGid: 'task1' }, signal),
      url: `${API_BASE_URL}/tasks/task1`,
      method: 'DELETE',
    },
    {
      name: 'get project',
      run: (signal: AbortSignal) =>
        executeAsanaGetProject({ ...AUTH, projectGid: 'project1' }, signal),
      url: `${API_BASE_URL}/projects/project1?opt_fields=${PROJECT_OPT_FIELDS}`,
      method: 'GET',
    },
    {
      name: 'get projects',
      run: (signal: AbortSignal) =>
        executeAsanaGetProjects({ ...AUTH, workspace: 'workspace1' }, signal),
      url: `${API_BASE_URL}/projects?workspace=workspace1`,
      method: 'GET',
    },
    {
      name: 'get task',
      run: (signal: AbortSignal) => executeAsanaGetTask({ ...AUTH, taskGid: 'task1' }, signal),
      url: `${API_BASE_URL}/tasks/task1?opt_fields=${TASK_OPT_FIELDS}`,
      method: 'GET',
    },
    {
      name: 'list sections',
      run: (signal: AbortSignal) =>
        executeAsanaListSections({ ...AUTH, projectGid: 'project1' }, signal),
      url: `${API_BASE_URL}/projects/project1/sections`,
      method: 'GET',
    },
    {
      name: 'list workspaces',
      run: (signal: AbortSignal) => executeAsanaListWorkspaces(AUTH, signal),
      url: `${API_BASE_URL}/workspaces?limit=100`,
      method: 'GET',
    },
    {
      name: 'search tasks',
      run: (signal: AbortSignal) =>
        executeAsanaSearchTasks({ ...AUTH, workspace: 'workspace1' }, signal),
      url: `${API_BASE_URL}/workspaces/workspace1/tasks/search?${searchParams.toString()}`,
      method: 'GET',
    },
    {
      name: 'update task',
      run: (signal: AbortSignal) =>
        executeAsanaUpdateTask({ ...AUTH, taskGid: 'task1', completed: true }, signal),
      url: `${API_BASE_URL}/tasks/task1`,
      method: 'PUT',
    },
  ]

  it.each(operationCases)('executes $name with cancellation', async ({ run, url, method }) => {
    const controller = new AbortController()

    await run(controller.signal)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ method, signal: controller.signal })
    )
  })

  it('preserves task-list pagination, project precedence, and the default limit', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              gid: 'task1',
              name: 'Task',
              notes: '',
              completed: false,
              assignee: { gid: 'user1', name: 'Person' },
            },
          ],
          next_page: { offset: 'next' },
        })
      )
    )

    const result = await executeAsanaGetTask({
      ...AUTH,
      workspace: 'workspace1',
      project: 'project1',
    })

    const [url] = fetchMock.mock.calls[0]
    const parsedUrl = new URL(String(url))
    expect(parsedUrl.searchParams.get('project')).toBe('project1')
    expect(parsedUrl.searchParams.has('workspace')).toBe(false)
    expect(parsedUrl.searchParams.get('limit')).toBe('50')
    expect(result).toMatchObject({
      success: true,
      tasks: [
        {
          gid: 'task1',
          name: 'Task',
          completed: false,
          assignee: { gid: 'user1', name: 'Person' },
        },
      ],
      next_page: { offset: 'next' },
    })
  })

  it('preserves nullable search filters in the provider query', async () => {
    await executeAsanaSearchTasks({
      ...AUTH,
      workspace: 'workspace1',
      text: 'urgent',
      assignee: 'user1',
      projects: ['project1', 'project2'],
      completed: null,
    })

    const [url] = fetchMock.mock.calls[0]
    const parsedUrl = new URL(String(url))
    expect(parsedUrl.searchParams.get('text')).toBe('urgent')
    expect(parsedUrl.searchParams.get('assignee.any')).toBe('user1')
    expect(parsedUrl.searchParams.get('projects.any')).toBe('project1,project2')
    expect(parsedUrl.searchParams.get('completed')).toBe('null')
  })

  it('preserves optional create and nullable update payloads', async () => {
    await executeAsanaCreateTask({
      ...AUTH,
      workspace: 'workspace1',
      name: 'Task',
      notes: '',
      assignee: 'user1',
      due_on: '2026-09-01',
    })
    await executeAsanaUpdateTask({
      ...AUTH,
      taskGid: 'task1',
      name: null,
      notes: null,
      assignee: null,
      completed: null,
      due_on: null,
    })

    const createInit = fetchMock.mock.calls[0]?.[1]
    expect(JSON.parse(String(createInit?.body))).toEqual({
      data: {
        name: 'Task',
        workspace: 'workspace1',
        assignee: 'user1',
        due_on: '2026-09-01',
      },
    })
    const updateInit = fetchMock.mock.calls[1]?.[1]
    expect(JSON.parse(String(updateInit?.body))).toEqual({
      data: {
        name: null,
        notes: null,
        assignee: null,
        completed: null,
        due_on: null,
      },
    })
  })

  it('rejects invalid identifiers and missing task selectors before provider work', async () => {
    await expect(
      executeAsanaAddFollowers({ ...AUTH, taskGid: 'task1', followers: ['../user'] })
    ).rejects.toBeInstanceOf(AsanaOperationError)
    await expect(executeAsanaGetTask(AUTH)).rejects.toMatchObject({
      status: 400,
      body: { error: 'Either taskGid or workspace/project must be provided' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
