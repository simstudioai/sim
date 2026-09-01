/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => ({
  executeAsanaAddComment: vi.fn(),
  executeAsanaAddFollowers: vi.fn(),
  executeAsanaCreateProject: vi.fn(),
  executeAsanaCreateSection: vi.fn(),
  executeAsanaCreateSubtask: vi.fn(),
  executeAsanaCreateTask: vi.fn(),
  executeAsanaDeleteTask: vi.fn(),
  executeAsanaGetProject: vi.fn(),
  executeAsanaGetProjects: vi.fn(),
  executeAsanaGetTask: vi.fn(),
  executeAsanaListSections: vi.fn(),
  executeAsanaListWorkspaces: vi.fn(),
  executeAsanaSearchTasks: vi.fn(),
  executeAsanaUpdateTask: vi.fn(),
}))

vi.mock('@/lib/internal/asana/operations', () => operationMocks)

import { AsanaOperationError } from '@/lib/internal/asana/errors'
import { executeAsanaTool } from '@/lib/internal/asana/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const ACCESS_TOKEN = { accessToken: 'access-token' }

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'asana_list_workspaces',
    input: ACCESS_TOKEN,
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      workspaceId: 'workspace-1',
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  } as InternalToolOperationCall
}

const TOOL_CASES = [
  [
    'asana_add_comment',
    { ...ACCESS_TOKEN, taskGid: 'task1', text: 'Comment' },
    operationMocks.executeAsanaAddComment,
  ],
  [
    'asana_add_followers',
    { ...ACCESS_TOKEN, taskGid: 'task1', followers: ['user1'] },
    operationMocks.executeAsanaAddFollowers,
  ],
  [
    'asana_create_project',
    { ...ACCESS_TOKEN, workspace: 'workspace1', name: 'Project' },
    operationMocks.executeAsanaCreateProject,
  ],
  [
    'asana_create_section',
    { ...ACCESS_TOKEN, projectGid: 'project1', name: 'Section' },
    operationMocks.executeAsanaCreateSection,
  ],
  [
    'asana_create_subtask',
    { ...ACCESS_TOKEN, taskGid: 'task1', name: 'Subtask' },
    operationMocks.executeAsanaCreateSubtask,
  ],
  [
    'asana_create_task',
    { ...ACCESS_TOKEN, workspace: 'workspace1', name: 'Task' },
    operationMocks.executeAsanaCreateTask,
  ],
  [
    'asana_delete_task',
    { ...ACCESS_TOKEN, taskGid: 'task1' },
    operationMocks.executeAsanaDeleteTask,
  ],
  [
    'asana_get_project',
    { ...ACCESS_TOKEN, projectGid: 'project1' },
    operationMocks.executeAsanaGetProject,
  ],
  [
    'asana_get_projects',
    { ...ACCESS_TOKEN, workspace: 'workspace1' },
    operationMocks.executeAsanaGetProjects,
  ],
  ['asana_get_task', { ...ACCESS_TOKEN, taskGid: 'task1' }, operationMocks.executeAsanaGetTask],
  [
    'asana_list_sections',
    { ...ACCESS_TOKEN, projectGid: 'project1' },
    operationMocks.executeAsanaListSections,
  ],
  ['asana_list_workspaces', ACCESS_TOKEN, operationMocks.executeAsanaListWorkspaces],
  [
    'asana_search_tasks',
    { ...ACCESS_TOKEN, workspace: 'workspace1' },
    operationMocks.executeAsanaSearchTasks,
  ],
  [
    'asana_update_task',
    { ...ACCESS_TOKEN, taskGid: 'task1', completed: true },
    operationMocks.executeAsanaUpdateTask,
  ],
] as const

describe('executeAsanaTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(TOOL_CASES)('validates and dispatches %s', async (toolId, input, operation) => {
    const controller = new AbortController()
    operation.mockResolvedValue({ toolId })

    const response = await executeAsanaTool(
      createRequest({ toolId, input, signal: controller.signal })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ toolId })
    expect(operation).toHaveBeenCalledWith(input, controller.signal)
  })

  it('requires an authenticated user before parsing or provider work', async () => {
    const response = await executeAsanaTool(
      createRequest({ input: '{', context: createExecutionContext({ workflowId: 'workflow-1' }) })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(operationMocks.executeAsanaListWorkspaces).not.toHaveBeenCalled()
  })

  it('returns the canonical validation envelope before provider work', async () => {
    const response = await executeAsanaTool(createRequest({ input: { accessToken: '' } }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(operationMocks.executeAsanaListWorkspaces).not.toHaveBeenCalled()
  })

  it('rejects non-object operation input before provider work', async () => {
    const response = await executeAsanaTool(createRequest({ input: '{' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(operationMocks.executeAsanaListWorkspaces).not.toHaveBeenCalled()
  })

  it('preserves provider status and error envelopes', async () => {
    operationMocks.executeAsanaListWorkspaces.mockRejectedValue(
      new AsanaOperationError('Asana API error: 429 Too Many Requests', 429, {
        success: false,
        error: 'Asana API error: 429 Too Many Requests',
        details: '{"errors":[]}',
      })
    )

    const response = await executeAsanaTool(createRequest())

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Asana API error: 429 Too Many Requests',
      details: '{"errors":[]}',
    })
  })

  it('preserves fixed unexpected error envelopes', async () => {
    operationMocks.executeAsanaListWorkspaces.mockRejectedValue(new Error('Asana unavailable'))

    const response = await executeAsanaTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to retrieve Asana workspaces',
      details: 'Asana unavailable',
    })
  })

  it('preserves dynamic unexpected error envelopes', async () => {
    operationMocks.executeAsanaCreateTask.mockRejectedValue(new Error('Asana unavailable'))

    const response = await executeAsanaTool(
      createRequest({
        toolId: 'asana_create_task',
        input: { ...ACCESS_TOKEN, workspace: 'workspace1', name: 'Task' },
      })
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Asana unavailable',
      success: false,
    })
  })

  it('rejects unsupported Asana IDs without provider work', async () => {
    const response = await executeAsanaTool(createRequest({ toolId: 'asana_unknown' }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Unsupported Asana tool: asana_unknown',
    })
    expect(operationMocks.executeAsanaListWorkspaces).not.toHaveBeenCalled()
  })

  it('propagates cancellation without starting provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeAsanaTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operationMocks.executeAsanaListWorkspaces).not.toHaveBeenCalled()
  })
})
