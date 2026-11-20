import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Output past the 64 KiB a pipe buffers is where an exit that does not wait
 * for stdout loses data, so every case here writes megabytes into a pipe whose
 * reader starts late.
 */
const ROWS = 20_000
const READER_DELAY_MS = 400

interface PipedRun {
  exitCode: number | null
  stdout: string
  stderr: string
}

/** Spawns `command`, holds its stdout pipe unread for a moment, then drains it. */
function runPiped(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<PipedRun> {
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').pause()
  setTimeout(() => child.stdout.resume(), READER_DELAY_MS)
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk
  })
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }))
  })
}

describe('stdout piped to a slow reader', () => {
  let dir: string
  let server: Server
  let endpoint: string
  const rows = Array.from({ length: ROWS }, (_, index) => ({
    id: `row_${index}`,
    data: { name: 'x'.repeat(50), index },
  }))

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sim-cli-pipe-'))
    server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const limit = Number(url.searchParams.get('limit') ?? 100)
      const start = Number(url.searchParams.get('cursor') ?? 0)
      const next = start + limit < rows.length ? String(start + limit) : null
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ data: rows.slice(start, start + limit), nextCursor: next }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  })

  function cliEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      SIM_CONFIG_DIR: join(dir, 'config'),
      SIM_ENDPOINT: endpoint,
      SIM_API_KEY: 'sk-test',
      SIM_WORKSPACE: 'ws_1',
      SIM_NO_UPDATE_CHECK: '1',
      SIM_CLI_TELEMETRY_DISABLED: '1',
      NO_PROXY: '127.0.0.1',
    }
  }

  it('writes every row of a long list before exiting 0', async () => {
    const entrypoint = join(import.meta.dirname, 'index.ts')
    const list = (output: string) =>
      runPiped(
        'bun',
        [entrypoint, '--output', output, 'tables', 'rows', 'list', 'tbl_1', '--limit', '0'],
        cliEnv()
      )

    const json = await list('json')
    expect(json.stderr).toBe('')
    expect(json.exitCode).toBe(0)
    expect(json.stdout.length).toBeGreaterThan(1024 * 1024)
    expect(JSON.parse(json.stdout).data).toHaveLength(ROWS)

    const table = await list('table')
    expect(table.exitCode).toBe(0)
    expect(table.stdout.trimEnd().split('\n').length).toBeGreaterThan(ROWS)
  }, 60_000)

  /**
   * The failing command writes its output first and its error after, the order
   * a failed `workflows run` uses, and exits with the error's code.
   */
  function failingCommandSource(terminalModule: string): string {
    return `
      import { Command, runTerminalCli, printLine, SimApiError } from ${JSON.stringify(terminalModule)}
      const program = new Command('sim')
      program.command('fail').action(() => {
        printLine('y'.repeat(${2 * 1024 * 1024}))
        throw new SimApiError('the run failed', 0, 'RUN_FAILED', undefined, 5)
      })
      process.argv = [process.argv[0], 'sim', 'fail']
      await runTerminalCli(program)
    `
  }

  it('drains stdout before exiting with an error code, under Bun and Node', async () => {
    const harness = join(dir, 'harness.ts')
    writeFileSync(
      harness,
      `export { Command } from ${JSON.stringify(createRequire(import.meta.url).resolve('commander'))}
export { runTerminalCli } from ${JSON.stringify(join(import.meta.dirname, 'terminal.ts'))}
export { printLine } from ${JSON.stringify(join(import.meta.dirname, 'output/io.ts'))}
export { SimApiError } from ${JSON.stringify(join(import.meta.dirname, 'http/client.ts'))}
`
    )
    const bundle = join(dir, 'harness.mjs')
    execFileSync('bun', ['build', harness, '--target=node', '--format=esm', '--outfile', bundle], {
      stdio: 'pipe',
    })
    const script = join(dir, 'fail.mjs')
    writeFileSync(script, failingCommandSource(bundle))

    for (const runtime of ['bun', process.execPath]) {
      const run = await runPiped(runtime, [script], cliEnv())
      expect(run.exitCode).toBe(5)
      expect(run.stdout.length).toBe(2 * 1024 * 1024 + 1)
      expect(run.stderr).toContain('the run failed')
    }
  }, 60_000)
})
