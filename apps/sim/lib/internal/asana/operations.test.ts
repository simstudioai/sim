import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AsanaOperationError } from '@/lib/internal/asana/errors'
import {
  executeAsanaAddFollowers,
  executeAsanaGetTask,
  executeAsanaSearchTasks,
} from '@/lib/internal/asana/operations'

const AUTH = { accessToken: 'access-token' }

describe('Asana operations', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ data: {}, next_page: { offset: 'next' } }))
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

  it('sends the assignee and offset Asana requires for a workspace task list', async () => {
    await executeAsanaGetTask({ ...AUTH, workspace: 'workspace1', assignee: 'me', offset: 'tok' })

    const parsedUrl = new URL(String(fetchMock.mock.calls[0][0]))
    expect(parsedUrl.searchParams.get('workspace')).toBe('workspace1')
    expect(parsedUrl.searchParams.get('assignee')).toBe('me')
    expect(parsedUrl.searchParams.get('offset')).toBe('tok')
  })

  it('rejects a workspace task list without an assignee and out-of-range page sizes', async () => {
    await expect(executeAsanaGetTask({ ...AUTH, workspace: 'workspace1' })).rejects.toMatchObject({
      status: 400,
      body: { error: 'assignee is required when listing tasks by workspace' },
    })
    await expect(
      executeAsanaSearchTasks({ ...AUTH, workspace: 'workspace1', limit: 500 })
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      executeAsanaGetTask({ ...AUTH, project: 'project1', limit: '2.5' })
    ).rejects.toMatchObject({ status: 400 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the search page size', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })))
    await executeAsanaSearchTasks({ ...AUTH, workspace: 'workspace1', limit: 25 })

    const parsedUrl = new URL(String(fetchMock.mock.calls[0][0]))
    expect(parsedUrl.searchParams.get('limit')).toBe('25')
  })
})
