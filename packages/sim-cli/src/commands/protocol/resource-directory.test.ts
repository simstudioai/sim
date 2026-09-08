import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGeneratedCommands } from '../../runtime/build'
import { attachProtocolCommands } from './index'

const { mockRequest, output } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  output: { format: 'json' },
}))

vi.mock('../../context', () => ({
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
  const override = (command: Command) => {
    command.exitOverride()
    command.commands.forEach(override)
  }
  override(root)
  return root
}

beforeEach(() => {
  vi.restoreAllMocks()
  mockRequest.mockReset()
  output.format = 'json'
})

describe('resource directory', () => {
  it('makes ls and mkdir available for every folder-backed resource', () => {
    for (const resource of ['files', 'knowledge', 'tables', 'workflows']) {
      const group = program().commands.find((command) => command.name() === resource)
      expect(group?.commands.some((command) => command.name() === 'ls')).toBe(true)
      expect(group?.commands.some((command) => command.name() === 'mkdir')).toBe(true)
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
              webUrl: 'https://sim.example/workspace/ws_local/tables/tbl_1',
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

    await program().parseAsync(['node', 'sim', 'table', 'ls', 'Reports', '--search', 'r'])

    expect(mockRequest).toHaveBeenCalledWith('/api/v2/tables/folders', {
      query: {
        workspaceId: 'ws_local',
        parentPath: 'Reports',
        search: 'r',
        sortBy: 'name',
        sortOrder: 'asc',
      },
    })
    expect(mockRequest).toHaveBeenCalledWith('/api/v2/tables', {
      query: {
        workspaceId: 'ws_local',
        folderPath: 'Reports',
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
        webUrl: 'https://sim.example/workspace/ws_local/tables/tbl_1',
        folderPath: '/Reports',
        updatedAt: '2026-08-03T00:00:00.000Z',
      },
    ])
  })

  it('creates a folder through the generated resource operation', async () => {
    mockRequest.mockResolvedValue({
      data: {
        folder: {
          name: 'Quarterly',
          path: '/Reports/Quarterly',
          parentPath: '/Reports',
          createdAt: '2026-08-04T00:00:00.000Z',
          updatedAt: '2026-08-04T00:00:00.000Z',
        },
      },
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await program().parseAsync(['node', 'sim', 'table', 'mkdir', 'Reports/Quarterly'])

    expect(mockRequest).toHaveBeenCalledWith('/api/v2/tables/folders', {
      method: 'POST',
      body: { workspaceId: 'ws_local', path: 'Reports/Quarterly' },
    })
  })

  it('encodes the path both commands take, as every contract-driven flag does', async () => {
    // These two build their own request, so `buildRequest`'s encoding never ran
    // for them: `--folder '/Folder 1'` worked while `ls '/Folder 1'` was
    // rejected as non-canonical, and `mkdir` disagreed with the `folders
    // create` the README calls its long form.
    mockRequest.mockResolvedValue({ data: [], nextCursor: null })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await program().parseAsync(['node', 'sim', 'table', 'ls', '/Q1 (draft)'])
    expect(mockRequest).toHaveBeenCalledWith('/api/v2/tables/folders', {
      query: expect.objectContaining({ parentPath: '/Q1%20%28draft%29' }),
    })

    mockRequest.mockReset()
    mockRequest.mockResolvedValue({ data: { folder: {} } })
    await program().parseAsync(['node', 'sim', 'table', 'mkdir', '/Q1 (draft)'])
    expect(mockRequest).toHaveBeenCalledWith('/api/v2/tables/folders', {
      method: 'POST',
      body: { workspaceId: 'ws_local', path: '/Q1%20%28draft%29' },
    })
  })

  it('decodes folder paths for the human formats but leaves json on the wire form', async () => {
    // `ls` builds its own columns, so the contract's `folder-path` display
    // format never reached it: the sibling `folders list` printed `/Folder 2`
    // while `ls` printed `/Folder%202` for the same folder, one column away
    // from the decoded `name` it prints beside it.
    mockRequest.mockImplementation(async (path: string) => {
      if (path === '/api/v2/tables/folders') {
        return {
          data: [
            {
              name: 'New folder',
              path: '/Folder%202/New%20folder',
              parentPath: '/Folder%202',
              updatedAt: '2026-08-02T00:00:00.000Z',
            },
          ],
          nextCursor: null,
        }
      }
      return {
        data: [
          {
            id: 'tbl_1',
            name: 'Revenue',
            folderPath: '/Folder%202',
            updatedAt: '2026-08-03T00:00:00.000Z',
          },
        ],
        nextCursor: null,
      }
    })

    const logged: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => logged.push(line))

    output.format = 'text'
    await program().parseAsync(['node', 'sim', 'table', 'ls', '/Folder 2'])
    expect(logged.join('\n')).toContain('/Folder 2/New folder')
    expect(logged.join('\n')).not.toContain('%20')

    logged.length = 0
    output.format = 'json'
    await program().parseAsync(['node', 'sim', 'table', 'ls', '/Folder 2'])
    const entries = JSON.parse(logged[0]) as Array<{ kind: string; ref: string }>
    expect(entries.find((entry) => entry.kind === 'folder')?.ref).toBe('/Folder%202/New%20folder')
    expect(entries.find((entry) => entry.kind === 'table')?.ref).toBe('tbl_1')
  })

  it('honors the combined listing limit without a pagination notice', async () => {
    mockRequest.mockImplementation(
      async (path: string, options: { query: { cursor?: string } }) => {
        if (path === '/api/v2/files/folders') return { data: [] }
        const cursor = Number(options.query.cursor ?? 0)
        return {
          data: Array.from({ length: 100 }, (_, index) => ({
            id: `file_${cursor}_${index}`,
            name: `file-${cursor}-${index}`,
            folderPath: '/',
            updatedAt: '2026-01-01T00:00:00.000Z',
          })),
          nextCursor: cursor < 2 ? String(cursor + 1) : null,
        }
      }
    )
    const written: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk))
      return true
    })
    const logged: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => logged.push(line))

    await program().parseAsync(['node', 'sim', 'files', 'ls', '--limit', '5'])
    expect(JSON.parse(logged.join('\n'))).toHaveLength(5)
    expect(written.join('')).toBe('')

    written.length = 0
    logged.length = 0
    await program().parseAsync(['node', 'sim', 'files', 'ls'])
    expect(JSON.parse(logged.join('\n'))).toHaveLength(300)
    expect(written.join('')).not.toContain('showing the first')
  })

  it('rejects extra directory arguments instead of silently ignoring them', async () => {
    await expect(
      program().parseAsync(['node', 'sim', 'file', 'ls', 'Reports', 'ignored'])
    ).rejects.toThrow(/too many arguments/i)
    expect(mockRequest).not.toHaveBeenCalled()
  })
})
