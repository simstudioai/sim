import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGeneratedCommands } from '../../runtime/build.js'
import { attachProtocolCommands } from './index.js'

const { mockRequest, output } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  output: { format: 'json' },
}))

vi.mock('../../context.js', () => ({
  clientFrom: () => ({
    client: { request: mockRequest, requireWorkspace: () => 'ws_local' },
    profile: {
      workspaceId: 'ws_local',
      output: output.format,
      name: 'default',
      apiKey: 'k',
      endpoint: 'https://sim.example',
    },
  }),
}))

function program(): Command {
  const root = new Command('sim').exitOverride()
  for (const group of buildGeneratedCommands()) root.addCommand(group)
  attachProtocolCommands(root)
  return root
}

beforeEach(() => {
  vi.restoreAllMocks()
  mockRequest.mockReset()
  output.format = 'json'
})

describe('resource ls', () => {
  it('is available for every folder-backed resource', () => {
    for (const resource of ['files', 'knowledge', 'tables', 'workflows']) {
      const group = program().commands.find((command) => command.name() === resource)
      expect(group?.commands.some((command) => command.name() === 'ls')).toBe(true)
    }
  })

  it('combines child folders and resources in one directory listing', async () => {
    mockRequest.mockImplementation(async (path: string) => {
      if (path === '/api/v2/tables/folders') {
        return {
          data: [
            {
              name: 'Archive',
              path: '/Reports/Archive',
              parentPath: '/Reports',
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: '2026-08-02T00:00:00.000Z',
            },
          ],
          nextCursor: null,
        }
      }
      if (path === '/api/v2/tables') {
        return {
          data: [
            {
              id: 'tbl_1',
              name: 'Revenue',
              folderPath: '/Reports',
              updatedAt: '2026-08-03T00:00:00.000Z',
            },
          ],
          nextCursor: null,
        }
      }
      throw new Error(`Unexpected path: ${path}`)
    })
    const logged: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => logged.push(line))

    await program().parseAsync([
      'node',
      'sim',
      'table',
      'ls',
      '--folder',
      '/Reports',
      '--search',
      'r',
    ])

    expect(mockRequest).toHaveBeenCalledWith('/api/v2/tables/folders', {
      query: {
        workspaceId: 'ws_local',
        parentPath: '/Reports',
        search: 'r',
        sortBy: 'name',
        sortOrder: 'asc',
      },
    })
    expect(mockRequest).toHaveBeenCalledWith('/api/v2/tables', {
      query: {
        workspaceId: 'ws_local',
        folderPath: '/Reports',
        search: 'r',
        sortBy: 'name',
        sortOrder: 'asc',
        limit: 100,
        cursor: null,
      },
    })
    expect(JSON.parse(logged[0])).toEqual([
      {
        kind: 'folder',
        name: 'Archive',
        ref: '/Reports/Archive',
        folderPath: '/Reports',
        updatedAt: '2026-08-02T00:00:00.000Z',
      },
      {
        kind: 'table',
        name: 'Revenue',
        ref: 'tbl_1',
        folderPath: '/Reports',
        updatedAt: '2026-08-03T00:00:00.000Z',
      },
    ])
  })
})
