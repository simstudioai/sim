import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { buildProgram } from './program'
import { runTerminalCli } from './terminal'

/**
 * Runs `sim <argv>` the way the installed binary does against a server that
 * answers with `response`, and returns what it wrote to stderr and its exit code.
 */
async function runAgainst(
  argv: string[],
  response: Response,
  { workspace = 'ws_1', profileWorkspace }: { workspace?: string; profileWorkspace?: string } = {}
): Promise<{ stderr: string; exitCode: number }> {
  const configDir = mkdtempSync(join(tmpdir(), 'sim-cli-terminal-'))
  if (profileWorkspace) {
    writeFileSync(join(configDir, 'config'), `[default]\nworkspace = ${profileWorkspace}\n`)
  }
  vi.stubEnv('SIM_CONFIG_DIR', configDir)
  vi.stubEnv('SIM_ENDPOINT', 'https://sim.example')
  vi.stubEnv('SIM_API_KEY', 'sk-test')
  vi.stubEnv('SIM_WORKSPACE', workspace)
  vi.stubEnv('SIM_NO_UPDATE_CHECK', '1')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

  let stderr = ''
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk)
    return true
  })
  vi.spyOn(console, 'error').mockImplementation((...lines: unknown[]) => {
    stderr += `${lines.join(' ')}\n`
  })
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ExitCalled(code ?? 0)
  }) as never)

  const originalArgv = process.argv
  process.argv = ['node', 'sim', ...argv]
  try {
    await runTerminalCli(buildProgram())
    throw new Error('the CLI did not exit')
  } catch (error) {
    if (!(error instanceof ExitCalled)) throw error
    return { stderr, exitCode: error.code }
  } finally {
    process.argv = originalArgv
    rmSync(configDir, { recursive: true, force: true })
  }
}

class ExitCalled extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`)
  }
}

describe('API errors at the terminal', () => {
  it('reports CSV file failures as structured JSON instead of crashing', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sim-cli-missing-csv-'))
    try {
      const { stderr, exitCode } = await runAgainst(
        [
          '--output',
          'json',
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
          '1',
          '--user-mapping',
          join(directory, 'missing.csv'),
          '--project-permissions',
          join(directory, 'projects.csv'),
          '--yes',
        ],
        Response.json({})
      )
      expect(exitCode).toBe(1)
      expect(JSON.parse(stderr).error.message).toContain('ENOENT')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('names the server request id in JSON output', async () => {
    const { stderr, exitCode } = await runAgainst(
      ['--output', 'json', 'workflows', 'get', 'wf-missing'],
      new Response(
        JSON.stringify({
          error: { code: 'NOT_FOUND', message: 'Workflow not found', requestId: 'req-body' },
        }),
        { status: 404, headers: { 'content-type': 'application/json' } }
      )
    )

    expect(exitCode).toBe(1)
    expect(JSON.parse(stderr)).toEqual({
      error: { code: 'NOT_FOUND', message: 'Workflow not found', requestId: 'req-body' },
    })
  })

  it('falls back to the x-request-id header when the body has none', async () => {
    const { stderr, exitCode } = await runAgainst(
      ['--output', 'text', 'workflows', 'get', 'wf-missing'],
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 403,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req-header' },
      })
    )

    expect(exitCode).toBe(1)
    expect(stderr).toContain('Unauthorized')
    expect(stderr).toMatch(/request id: req-header/)
  })
})

describe('a refused source write in JSON output', () => {
  it('keeps the refusal findings in the error document, without their frames', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sim-cli-refusal-'))
    const workflowId = '00000000-0000-4000-8000-00000000000a'
    mkdirSync(join(dir, '.sim'))
    writeFileSync(
      join(dir, 'workflow.ts'),
      "// @sim-sdk 1\nexport default workflow('W', () => {})\n"
    )
    writeFileSync(
      join(dir, '.sim/lock.json'),
      JSON.stringify({ version: 1, blocks: {}, variables: {} })
    )
    writeFileSync(
      join(dir, '.sim/base.json'),
      JSON.stringify({
        version: 1,
        workflowId,
        workspaceId: 'ws_1',
        fingerprint: 'sf1:a',
        catalogHash: 'h',
      })
    )
    const finding = {
      code: 'E_APPLY_STALE',
      severity: 'error',
      message: 'The workflow changed since this source was read.',
      file: 'workflow.ts',
      line: 1,
      column: 1,
    }
    try {
      const { stderr, exitCode } = await runAgainst(
        ['--output', 'json', 'workflows', 'source', 'apply', workflowId, '--dir', dir, '--dry'],
        new Response(
          JSON.stringify({
            error: {
              code: 'CONFLICT',
              message: 'The workflow changed since this source was read.',
              details: { code: 'SOURCE_STALE', diagnostics: [{ ...finding, frame: '> 1 | x' }] },
            },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } }
        )
      )

      expect(exitCode).toBe(5)
      const document = stderr.split('\n').find((line) => line.startsWith('{"error"'))
      expect(JSON.parse(document ?? '{}')).toMatchObject({
        error: { code: 'CONFLICT', details: { code: 'SOURCE_STALE', diagnostics: [finding] } },
      })
      expect(document).not.toContain('frame')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('a command run inside a source directory', () => {
  const notFound = () =>
    new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Table not found' } }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  const requestedUrl = () => String(vi.mocked(fetch).mock.calls[0]?.[0])

  /** Runs `sim [...flags] tables rows list tbl_1` from `cwd`, answered with a 404. */
  async function listRowsIn(
    cwd: string,
    options: Parameters<typeof runAgainst>[2],
    flags: string[] = []
  ): Promise<{ stderr: string; exitCode: number }> {
    const previous = process.cwd()
    process.chdir(cwd)
    try {
      return await runAgainst([...flags, 'tables', 'rows', 'list', 'tbl_1'], notFound(), options)
    } finally {
      process.chdir(previous)
    }
  }

  /** A directory holding `record` at `.sim/<file>`, with a `workflows/triage` folder below it. */
  function sourceDirectory(file: string, record: unknown): { root: string; folder: string } {
    const root = mkdtempSync(join(tmpdir(), 'sim-cli-source-dir-'))
    mkdirSync(join(root, '.sim'))
    writeFileSync(join(root, '.sim', file), JSON.stringify(record))
    const folder = join(root, 'workflows', 'triage')
    mkdirSync(folder, { recursive: true })
    return { root, folder }
  }

  it('acts on the workspace the nearest one names, below -w and SIM_WORKSPACE and above the profile', async () => {
    const { root, folder } = sourceDirectory('base.json', { workspaceId: 'ws_dir' })
    try {
      const inDirectory = await listRowsIn(folder, {
        workspace: '',
        profileWorkspace: 'ws_profile',
      })
      expect(requestedUrl()).toContain('ws_dir')
      expect(inDirectory.stderr).toContain(
        `searched workspace ws_dir, the workspace of the source directory ${realpathSync(root)}`
      )

      await listRowsIn(folder, {})
      expect(requestedUrl()).toContain('ws_1')
      expect(requestedUrl()).not.toContain('ws_dir')

      await listRowsIn(folder, { workspace: '' }, ['-w', 'ws_flag'])
      expect(requestedUrl()).toContain('ws_flag')

      await listRowsIn(tmpdir(), { workspace: '', profileWorkspace: 'ws_profile' })
      expect(requestedUrl()).toContain('ws_profile')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('acts on the workspace a starter was written for, as a create from it does', async () => {
    const { root } = sourceDirectory('starter.json', { workspaceId: 'ws_starter' })
    try {
      await listRowsIn(root, { workspace: '', profileWorkspace: 'ws_profile' })
      expect(requestedUrl()).toContain('ws_starter')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
