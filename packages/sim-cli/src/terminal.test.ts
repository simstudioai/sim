import { mkdtempSync, rmSync } from 'node:fs'
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
  response: Response
): Promise<{ stderr: string; exitCode: number }> {
  const configDir = mkdtempSync(join(tmpdir(), 'sim-cli-terminal-'))
  vi.stubEnv('SIM_CONFIG_DIR', configDir)
  vi.stubEnv('SIM_ENDPOINT', 'https://sim.example')
  vi.stubEnv('SIM_API_KEY', 'sk-test')
  vi.stubEnv('SIM_WORKSPACE', 'ws_1')
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
