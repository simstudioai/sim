import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutputFormat, ResolvedProfile } from '../../config/index'
import { buildGeneratedCommands } from '../../runtime/build'
import { attachProtocolCommands } from './index'

interface SentRequest {
  method: string
  url: URL
  body: unknown
}

interface Wire {
  output: { format: OutputFormat }
  sent: SentRequest[]
  respond: (url: URL) => unknown
}

const wire: Wire = vi.hoisted(() => ({
  output: { format: 'json' },
  sent: [],
  respond: () => ({ data: [], nextCursor: null }),
}))

vi.mock('../../context', async () => {
  const { SimClient } = await import('../../http/client')
  return {
    clientFrom: () => {
      const profile: ResolvedProfile = {
        name: 'default',
        authProfile: 'default',
        endpoint: 'https://sim.example',
        apiKey: 'k',
        oauth: null,
        workspaceId: 'ws_local',
        output: wire.output.format,
        sources: { endpoint: 'flag', credential: 'flag', workspaceId: 'flag', output: 'flag' },
        transport: async (input: string | URL | Request, init?: RequestInit) => {
          const url = new URL(String(input))
          wire.sent.push({
            method: init?.method ?? 'GET',
            url,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          })
          return new Response(JSON.stringify(wire.respond(url)), {
            headers: { 'content-type': 'application/json' },
          })
        },
      }
      return { client: new SimClient(profile), profile }
    },
  }
})

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
  wire.sent.length = 0
  wire.respond = () => ({ data: [], nextCursor: null })
  wire.output.format = 'json'
})

function sentTo(path: string): SentRequest[] {
  return wire.sent.filter((request) => request.url.pathname === path)
}

describe('resource directory', () => {
  it('encodes the path both commands take, as every contract-driven flag does', async () => {
    // These two build their own request, so `buildRequest`'s encoding never ran
    // for them: `--folder '/Folder 1'` worked while `ls '/Folder 1'` was
    // rejected as non-canonical, and `mkdir` disagreed with the `folders
    // create` the README calls its long form.
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await program().parseAsync(['node', 'sim', 'table', 'ls', '/Q1 (draft)'])
    const [listed] = sentTo('/api/v2/tables/folders')
    expect(listed.method).toBe('GET')
    expect(listed.url.searchParams.get('parentPath')).toBe('/Q1%20%28draft%29')

    wire.sent.length = 0
    wire.respond = () => ({ data: { folder: {} } })
    await program().parseAsync(['node', 'sim', 'table', 'mkdir', '/Q1 (draft)'])
    expect(sentTo('/api/v2/tables/folders')).toEqual([
      expect.objectContaining({
        method: 'POST',
        body: { workspaceId: 'ws_local', path: '/Q1%20%28draft%29' },
      }),
    ])
  })

  it('decodes folder paths for the human formats but leaves json on the wire form', async () => {
    // `ls` builds its own columns, so the contract's `folder-path` display
    // format never reached it: the sibling `folders list` printed `/Folder 2`
    // while `ls` printed `/Folder%202` for the same folder, one column away
    // from the decoded `name` it prints beside it.
    wire.respond = (url) => {
      if (url.pathname === '/api/v2/tables/folders') {
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
    }

    const logged: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => logged.push(line))

    wire.output.format = 'text'
    await program().parseAsync(['node', 'sim', 'table', 'ls', '/Folder 2'])
    expect(logged.join('\n')).toContain('/Folder 2/New folder')
    expect(logged.join('\n')).not.toContain('%20')

    logged.length = 0
    wire.output.format = 'json'
    await program().parseAsync(['node', 'sim', 'table', 'ls', '/Folder 2'])
    const entries = JSON.parse(logged[0]) as Array<{ kind: string; ref: string }>
    expect(entries.find((entry) => entry.kind === 'folder')?.ref).toBe('/Folder%202/New%20folder')
    expect(entries.find((entry) => entry.kind === 'table')?.ref).toBe('tbl_1')
  })
})
