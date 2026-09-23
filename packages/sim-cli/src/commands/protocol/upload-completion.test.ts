import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachProtocolCommands } from '#sim-cli/commands/protocol/index'
import type { ResolvedProfile } from '#sim-cli/config/index'
import { SimClient } from '#sim-cli/http/client'
import { buildGeneratedCommands } from '#sim-cli/runtime/build'

const context = vi.hoisted(() => ({ client: null as SimClient | null }))

vi.mock('#sim-cli/context', () => ({
  clientFrom: () => ({ client: context.client, profile: { output: 'json' } }),
}))
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(async () => {}) }))

let directory: string
let path: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sim-upload-completion-'))
  path = join(directory, 'data.csv')
  await writeFile(path, 'name\nAlice\n')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await rm(directory, { recursive: true, force: true })
})

function setup(
  basePath: string,
  result: Record<string, unknown>,
  current: Record<string, unknown> = result
) {
  const requests: Request[] = []
  let completionRequests = 0
  const profile: ResolvedProfile = {
    name: 'fixture',
    authProfile: 'fixture',
    endpoint: 'https://sim.test',
    apiKey: 'fixture-key',
    oauth: null,
    workspaceId: 'workspace',
    output: 'json',
    sources: { endpoint: 'env', credential: 'env', workspaceId: 'env', output: 'default' },
    transport: async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      const pathname = new URL(request.url).pathname
      if (pathname === basePath) {
        return Response.json({
          data: {
            session: { id: 'upload', status: 'uploading' },
            uploadToken: 'private-token',
            transfer: { method: 'put', url: 'https://storage.test/upload', headers: {} },
          },
        })
      }
      if (pathname === `${basePath}/upload/complete`) {
        if (++completionRequests === 1) throw new TypeError('Acknowledgement connection lost')
        return Response.json({ data: result })
      }
      if (pathname === `${basePath}/upload` && request.method === 'GET') {
        return Response.json({ data: current })
      }
      throw new Error(`Unexpected request: ${request.method} ${pathname}`)
    },
  }
  context.client = new SimClient(profile)
  return requests
}

async function run(args: string[]) {
  const program = new Command('sim').exitOverride()
  for (const group of buildGeneratedCommands()) program.addCommand(group)
  attachProtocolCommands(program)
  await program.parseAsync(['node', 'sim', ...args])
}

describe('upload command completion replay policy', () => {
  it.each(['processing', 'completed'])(
    'reconciles a table import in %s without replaying completion',
    async (status) => {
      const requests = setup('/api/v2/tables/imports', {
        id: 'upload',
        status,
        tableId: 'table',
        rowsProcessed: 0,
      })

      await run(['tables', 'import', path, '--no-wait'])

      expect(
        requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)
      ).toEqual([
        'POST /api/v2/tables/imports',
        'POST /api/v2/tables/imports/upload/complete',
        'GET /api/v2/tables/imports/upload',
      ])
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`"status": "${status}"`))
    }
  )

  it.each(['uploading', 'failed', 'canceled', 'expired'])(
    'preserves a table import in %s without reporting success, replaying, or aborting it',
    async (status) => {
      const requests = setup('/api/v2/tables/imports', { status })

      await expect(run(['tables', 'import', path, '--no-wait'])).rejects.toMatchObject({
        code: 'UPLOAD_COMPLETION_UNCONFIRMED',
      })

      expect(requests.map((request) => request.method)).toEqual(['POST', 'POST', 'GET'])
      expect(console.log).not.toHaveBeenCalled()
    }
  )

  it.each([
    {
      command: ['files', 'upload'],
      basePath: '/api/v2/files/uploads',
      result: { file: { id: 'file' } },
    },
    {
      command: ['knowledge', 'documents', 'upload', 'knowledge-base'],
      basePath: '/api/v2/knowledge/knowledge-base/documents/uploads',
      result: { document: { id: 'document', knowledgeBaseId: 'knowledge-base' } },
    },
  ])('replays idempotent completion for $basePath', async ({ command, basePath, result }) => {
    const requests = setup(basePath, result)

    await run([...command, path])

    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual(
      [`POST ${basePath}`, `POST ${basePath}/upload/complete`, `POST ${basePath}/upload/complete`]
    )
    expect(console.log).toHaveBeenCalledOnce()
  })
})
