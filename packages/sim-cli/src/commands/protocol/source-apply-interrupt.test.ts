import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const WORKFLOW_ID = '00000000-0000-4000-8000-00000000000a'
const WORKSPACE_ID = 'ws_local'
const BASE = {
  workflowId: WORKFLOW_ID,
  workspaceId: WORKSPACE_ID,
  fingerprint: 'sf1:a',
  catalogHash: 'h',
}
const LOCK = { version: 1, blocks: {}, variables: {} }
const ENTRY = "// @sim-sdk 1\nexport default workflow('W', () => {})\n"
/** How long the server holds the committing request before it answers. */
const COMMIT_DELAY_MS = 1_500

function applied() {
  return {
    data: {
      workflowId: WORKFLOW_ID,
      workspaceId: WORKSPACE_ID,
      dryRun: false,
      applied: true,
      diff: {
        noop: false,
        blocks: { added: [{ id: 'b-1', key: 'start' }], removed: [], renamed: [], modified: [] },
        edges: { added: 1, removed: 0 },
        variables: { added: [], removed: [], renamed: [], modified: [] },
      },
      diagnostics: [],
      files: { 'workflow.ts': `${ENTRY}// stored\n` },
      lock: LOCK,
      base: { ...BASE, fingerprint: 'sf1:b' },
      mintedIds: {},
      notes: [],
      needsRedeployment: true,
    },
  }
}

interface InterruptedRun {
  code: number | null
  signal: NodeJS.Signals | null
  stderr: string
}

let dir: string
let server: Server
let endpoint: string
/** Resolves the moment the server receives the committing request. */
let onCommit: () => void

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sim-source-interrupt-'))
  mkdirSync(join(dir, 'src'))
  mkdirSync(join(dir, 'src/.sim'))
  writeFileSync(join(dir, 'src/workflow.ts'), ENTRY)
  writeFileSync(join(dir, 'src/.sim/lock.json'), JSON.stringify(LOCK))
  writeFileSync(join(dir, 'src/.sim/base.json'), JSON.stringify(BASE))
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    request.resume()
    request.on('end', () => {
      onCommit()
      setTimeout(() => {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(applied()))
      }, COMMIT_DELAY_MS)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(dir, { recursive: true, force: true })
})

/**
 * Runs `sim workflows source apply --yes` as a real process and sends it SIGINT `interrupts`
 * times once the server holds its commit, 100 ms apart.
 */
function applyInterrupted(interrupts: number): Promise<InterruptedRun> {
  const child = spawn(
    'bun',
    [
      join(import.meta.dirname, '../../index.ts'),
      '--output',
      'json',
      'workflows',
      'source',
      'apply',
      '--yes',
      '--dir',
      join(dir, 'src'),
    ],
    {
      env: {
        ...process.env,
        SIM_CONFIG_DIR: join(dir, 'config'),
        SIM_ENDPOINT: endpoint,
        SIM_API_KEY: 'sk-test',
        SIM_WORKSPACE: WORKSPACE_ID,
        SIM_NO_UPDATE_CHECK: '1',
        SIM_CLI_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk
  })
  child.stdout.resume()
  onCommit = () => {
    for (let index = 0; index < interrupts; index += 1) {
      setTimeout(() => child.kill('SIGINT'), 100 * (index + 1))
    }
  }
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code, signal) => resolve({ code, signal, stderr }))
  })
}

function savedFingerprint(): string {
  return JSON.parse(readFileSync(join(dir, 'src/.sim/base.json'), 'utf8')).fingerprint
}

describe('Ctrl-C while a workflow apply is committing', () => {
  it('waits for the answer, saves it into the directory, then ends by the interrupt', async () => {
    const run = await applyInterrupted(1)

    expect(run.signal ?? run.code).toSatisfy(
      (status: unknown) => status === 'SIGINT' || status === 130
    )
    expect(run.stderr).toContain('the apply was already sent')
    expect(savedFingerprint()).toBe('sf1:b')
    expect(readFileSync(join(dir, 'src/workflow.ts'), 'utf8')).toContain('// stored')
    expect(existsSync(join(dir, 'src/.sim/command.lock'))).toBe(false)
  }, 30_000)

  it('stops at a second Ctrl-C and says the apply may have been saved and how to recover', async () => {
    const run = await applyInterrupted(2)

    expect(run.signal ?? run.code).toSatisfy(
      (status: unknown) => status === 'SIGINT' || status === 130
    )
    expect(run.stderr).toContain('Stopped before the apply answered. It may have been saved.')
    expect(run.stderr).toContain(`sim workflows source get ${WORKFLOW_ID}`)
    expect(savedFingerprint()).toBe('sf1:a')
    expect(existsSync(join(dir, 'src/.sim/command.lock'))).toBe(false)
  }, 30_000)
})
