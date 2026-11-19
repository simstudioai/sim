import { describe, expect, it, vi } from 'vitest'
import { runEmbeddedCli } from '#sim-cli/embed'

vi.mock('node:timers/promises', () => ({ setTimeout: async () => {} }))

const identity = { endpoint: 'https://sim.test', apiKey: 'test-key' }
const args = [
  'organizations',
  'search',
  'sources',
  'permissions',
  'upload',
  'source-1',
  '--organization',
  'org_test',
  '--provider',
  'gitlab',
  '--expected-revision',
  '7',
  '--user-mapping',
  'users.csv',
  '--project-permissions',
  'projects.csv',
  '--yes',
]

function snapshot(content: string, dispose: () => Promise<void>) {
  return {
    size: Buffer.byteLength(content),
    stream: async () => new Blob([content]).stream(),
    dispose,
  }
}

describe('Search permission CSV upload', () => {
  it('cancels a stalled snapshot on Node 20 without AbortSignal.any and releases its lease', async () => {
    const controller = new AbortController()
    const snapshotController = new AbortController()
    const originalAny = Object.getOwnPropertyDescriptor(AbortSignal, 'any')
    Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true })
    let disposed = false
    let cancelled = false
    try {
      const result = await runEmbeddedCli(
        args,
        { ...identity, signal: controller.signal },
        {
          openFile: async () => ({
            size: 100,
            signal: snapshotController.signal,
            stream: async () =>
              new ReadableStream({
                pull() {
                  controller.abort()
                },
                cancel() {
                  cancelled = true
                },
              }),
            dispose: async () => {
              disposed = true
            },
          }),
        }
      )
      expect(result.exitCode).toBe(1)
      expect(disposed).toBe(true)
      expect(cancelled).toBe(true)
      expect(result.stderr).toContain('cancelled')
    } finally {
      if (originalAny) Object.defineProperty(AbortSignal, 'any', originalAny)
      else Reflect.deleteProperty(AbortSignal, 'any')
    }
  })

  it('preserves snapshot I/O failures instead of blaming CSV syntax', async () => {
    let requests = 0
    const result = await runEmbeddedCli(
      args,
      {
        ...identity,
        transport: async () => {
          requests++
          return Response.json({})
        },
      },
      {
        openFile: async () => ({
          size: 100,
          stream: async () => {
            throw new Error('Remote snapshot reader unavailable')
          },
          dispose: async () => {},
        }),
      }
    )
    expect(result.exitCode).toBe(1)
    expect(requests).toBe(0)
    expect(result.stderr).toContain('Remote snapshot reader unavailable')
    expect(result.stderr).not.toContain('quoting')
  })

  it('splits multibyte records by bytes before the row limit without corrupting quoted fields', async () => {
    const content = `${'項'.repeat(500)},"quoted"\nline`
    const row = `"${content.replaceAll('"', '""')}",42\n`
    const parts: string[] = []
    const result = await runEmbeddedCli(
      args,
      {
        ...identity,
        transport: async (url, init) => {
          const path = String(url)
          const body = JSON.parse(String(init?.body ?? '{}'))
          if (path.endsWith('/imports')) return Response.json({ data: { id: 'import-1' } })
          if (path.endsWith('/complete')) return Response.json({ data: { revision: 8 } })
          if (body.field === 'projectPermissions') parts.push(body.content)
          return Response.json({ data: { nextPart: Number(path.split('/').at(-1)) + 1 } })
        },
      },
      {
        openFile: async (path) =>
          snapshot(path === 'users.csv' ? '42,p@example.com\n' : row.repeat(800), async () => {}),
      }
    )
    expect(result.exitCode, result.stderr).toBe(0)
    expect(parts).toHaveLength(2)
    expect(parts.every((part) => Buffer.byteLength(part) <= 1024 * 1024)).toBe(true)
    expect(parts.map((part) => part.slice('project_path,user_id\n'.length)).join('')).toBe(
      row.repeat(800)
    )
  })

  it('retries identical committed parts and a lost completion response without opening another import', async () => {
    const calls: { path: string; body: string }[] = []
    let partFailed = false
    let completionFailed = false
    const result = await runEmbeddedCli(
      args,
      {
        ...identity,
        transport: async (url, init) => {
          const path = new URL(String(url)).pathname
          calls.push({ path, body: String(init?.body ?? '') })
          if (path.endsWith('/imports')) return Response.json({ data: { id: 'import-1' } })
          if (path.endsWith('/parts/0') && !partFailed) {
            partFailed = true
            return Response.json(
              { error: { message: 'Try again' } },
              { status: 503, headers: { 'retry-after': '1' } }
            )
          }
          if (path.endsWith('/complete')) {
            if (!completionFailed) {
              completionFailed = true
              return new Response(
                new ReadableStream({
                  start(stream) {
                    stream.error(new Error('lost response'))
                  },
                }),
                { status: 200 }
              )
            }
            return Response.json({ data: { revision: 8 } })
          }
          return Response.json({ data: { nextPart: path.endsWith('/parts/0') ? 1 : 2 } })
        },
      },
      {
        openFile: async (path) =>
          snapshot(path === 'users.csv' ? '1,p@example.com\n' : 'team/repo,1\n', async () => {}),
      }
    )
    expect(result.exitCode, result.stderr).toBe(0)
    expect(calls.filter(({ path }) => path.endsWith('/imports'))).toHaveLength(1)
    expect(calls[1]).toEqual(calls[2])
    expect(calls.at(-1)).toEqual(calls.at(-2))
    expect(JSON.parse(result.stdout).revision).toBe(8)
  })
  it('stages immutable bounded parts, preserves CSV records, and activates only after both files', async () => {
    const requests: { path: string; body: Record<string, unknown> }[] = []
    const released: string[] = []
    const users = '\ufeff user_id , email \r\n \t\r\n 42 , "person@example.com" \r\n'
    const grants = `project_path,user_id\n${' "team/repo" , 42 \n'.repeat(5001)}`
    const result = await runEmbeddedCli(
      args,
      {
        ...identity,
        transport: async (url, init) => {
          const path = new URL(String(url)).pathname
          const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
          requests.push({ path, body })
          const data = path.endsWith('/imports')
            ? { id: 'import-1', expiresAt: '2027-01-01T00:00:00Z' }
            : path.endsWith('/complete')
              ? { revision: 8 }
              : { nextPart: requests.length - 1 }
          return Response.json({ data })
        },
      },
      {
        openFile: async (path) =>
          snapshot(path === 'users.csv' ? users : grants, async () => {
            released.push(path)
          }),
      }
    )
    expect(result.exitCode, result.stderr).toBe(0)
    expect(requests[0].body).toMatchObject({
      expectedRevision: 7,
      userMapping: { rowCount: 1, parts: 1 },
      projectPermissions: { rowCount: 5001, parts: 2 },
    })
    const parts = requests.slice(1, -1)
    expect(parts[0].body.content).toBe('user_id,email\n42,person@example.com\n')
    expect(parts.map(({ body }) => body.field)).toEqual([
      'userMapping',
      'projectPermissions',
      'projectPermissions',
    ])
    expect(parts.every(({ body }) => Buffer.byteLength(String(body.content)) <= 1024 * 1024)).toBe(
      true
    )
    expect(
      parts
        .slice(1)
        .reduce((n, { body }) => n + (String(body.content).match(/team\/repo,42/g)?.length ?? 0), 0)
    ).toBe(5001)
    expect(requests.at(-1)?.path).toMatch(/\/import-1\/complete$/)
    expect(JSON.parse(result.stdout)).toMatchObject({ revision: 8 })
    expect(released.sort()).toEqual(['projects.csv', 'users.csv'])
  })

  it('refuses malformed or oversized records before creating an import', async () => {
    for (const content of [
      'user_id,email\n42,"unfinished',
      `user_id,email\n42,${'x'.repeat(9000)}\n`,
    ]) {
      let requests = 0
      let released = false
      const result = await runEmbeddedCli(
        args,
        {
          ...identity,
          transport: async () => {
            requests++
            return Response.json({})
          },
        },
        {
          openFile: async () =>
            snapshot(content, async () => {
              released = true
            }),
        }
      )
      expect(result.exitCode).toBe(1)
      expect(requests).toBe(0)
      expect(released).toBe(true)
      expect(result.stderr).not.toContain(content)
    }
  })

  it('never activates or changes the pinned revision after a conflict', async () => {
    const paths: string[] = []
    const result = await runEmbeddedCli(
      args,
      {
        ...identity,
        transport: async (url) => {
          const path = String(url)
          paths.push(path)
          return path.endsWith('/imports')
            ? Response.json({ data: { id: 'import-1' } })
            : Response.json(
                { error: { code: 'CONFLICT', message: 'Permissions changed' } },
                { status: 409 }
              )
        },
      },
      {
        openFile: async (path) =>
          snapshot(
            path === 'users.csv'
              ? 'user_id,email\n42,p@example.com\n'
              : 'project_path,user_id\nteam/repo,42\n',
            async () => {}
          ),
      }
    )
    expect(result.exitCode).toBe(1)
    expect(paths).toHaveLength(2)
    expect(paths.some((path) => path.endsWith('/complete'))).toBe(false)
  })

  it('requires confirmation and cannot read the embedding server filesystem', async () => {
    for (const argv of [args.filter((arg) => arg !== '--yes'), args]) {
      let requests = 0
      const result = await runEmbeddedCli(argv, {
        ...identity,
        transport: async () => {
          requests++
          return Response.json({})
        },
      })
      expect(result.exitCode).toBe(1)
      expect(requests).toBe(0)
      expect(result.stderr).toMatch(/--yes|no machine/)
    }
  })
})
