import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cliVersion } from '#sim-cli/version'
import { SimApiError } from '../http/client'
import {
  COMMAND_EVENT,
  type CommandEventProperties,
  type CommandTelemetryOptions,
  createCommandTelemetry,
} from './invocation'
import { loadTelemetryState, readTelemetryState, writeTelemetryState } from './state'
import type { CaptureRequest, IngestTarget } from './transport'

let dir: string
let statePath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-telemetry-'))
  statePath = join(dir, 'telemetry.json')
  vi.stubEnv('SIM_CONFIG_DIR', dir)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const TARGET = { key: 'phc_test', host: 'https://us.i.posthog.com' }
const NOW = new Date('2026-09-10T12:00:00.000Z')

/** A program shaped like the shipped one: root globals, a group with a leaf, and the telemetry group. */
function buildProgram(): Command {
  const program = new Command('sim')
    .exitOverride()
    .option('-P, --profile <name>')
    .option('--endpoint <url>')
    .option('-w, --workspace <id>')
    .option('--output <format>')
  const workflows = new Command('workflows')
  workflows
    .command('list')
    .option('--limit <n>')
    .option('--all')
    .action(() => {})
  workflows
    .command('get')
    .argument('<id>')
    .action(() => {})
  workflows.command('fail').action(() => {
    throw new SimApiError('Not found', 404, 'NOT_FOUND')
  })
  program.addCommand(workflows)
  const telemetry = new Command('telemetry')
  telemetry.command('disable').action(() => {})
  program.addCommand(telemetry)
  return program
}

type SentRequest = CaptureRequest<CommandEventProperties>

/** The one request a harness sent, typed as the CLI builds it. */
function sentBy(send: { mock: { calls: unknown[][] } }): SentRequest {
  return send.mock.calls[0][1] as SentRequest
}

function harness(overrides: Partial<CommandTelemetryOptions> = {}) {
  const send = vi.fn<(target: IngestTarget, request: CaptureRequest<object>) => void>()
  const write = vi.fn<(message: string) => void>()
  const exitListeners: Array<(exitCode: number) => void> = []
  const telemetry = createCommandTelemetry({
    env: {},
    ingestTarget: () => TARGET,
    onExit: (listener) => exitListeners.push(listener),
    send,
    now: () => NOW,
    elapsed: () => 1432.4,
    stdoutIsTty: false,
    stderrIsTty: false,
    write,
    ...overrides,
  })
  const program = buildProgram()
  telemetry.observe(program)
  return {
    telemetry,
    program,
    send,
    write,
    exit: (code: number) => exitListeners.forEach((l) => l(code)),
  }
}

async function run(program: Command, argv: string[]): Promise<unknown> {
  try {
    await program.parseAsync(['node', 'sim', ...argv])
    return undefined
  } catch (error) {
    return error
  }
}

describe('command telemetry', () => {
  it('reports the command path, typed flag names, and argument count — never values', async () => {
    const { telemetry, program, send } = harness()

    await run(program, ['--output', 'json', 'workflows', 'list', '--limit', '5', '--all'])
    telemetry.complete({ exitCode: 0 })

    expect(send).toHaveBeenCalledOnce()
    const request = sentBy(send)
    expect(request.event).toBe(COMMAND_EVENT)
    expect(request.api_key).toBe('phc_test')
    expect(request.timestamp).toBe(NOW.toISOString())
    expect(request.properties).toMatchObject({
      $lib: 'sim-cli',
      $lib_version: cliVersion(),
      $process_person_profile: false,
      session_sequence: 1,
      surface: 'cli',
      command: 'workflows list',
      flags: expect.arrayContaining(['--limit', '--all', '--output']),
      arg_count: 0,
      exit_code: 0,
      duration_ms: 1432,
      cli_version: cliVersion(),
      node_version: process.versions.node,
      os: process.platform,
      arch: process.arch,
      is_tty: false,
      is_ci: false,
      endpoint_kind: 'hosted',
    })
    expect(JSON.stringify(request)).not.toContain('json')
    expect(JSON.stringify(request)).not.toContain('"5"')
  })

  it('counts positional arguments without recording them', async () => {
    const { telemetry, program, send } = harness()

    await run(program, ['workflows', 'get', 'wf_secret_id'])
    telemetry.complete({ exitCode: 0 })

    expect(sentBy(send).properties).toMatchObject({ command: 'workflows get', arg_count: 1 })
    expect(JSON.stringify(sentBy(send))).not.toContain('wf_secret_id')
  })

  it('records a failure by class, code, and status, never by message', async () => {
    const { telemetry, program, send } = harness()

    const error = await run(program, ['workflows', 'fail'])
    telemetry.complete({ exitCode: 1, error })

    expect(sentBy(send).properties).toMatchObject({
      exit_code: 1,
      error_name: 'SimApiError',
      error_code: 'NOT_FOUND',
      http_status: 404,
    })
    expect(JSON.stringify(sentBy(send))).not.toContain('Not found')
  })

  it('honours an opt-out saved while the command was running', async () => {
    const { telemetry, program, send } = harness()

    await run(program, ['workflows', 'list'])
    writeTelemetryState({ ...loadTelemetryState(statePath), enabled: false }, statePath)
    telemetry.complete({ exitCode: 0 })

    expect(send).not.toHaveBeenCalled()
    expect(readTelemetryState(statePath)?.enabled).toBe(false)
  })

  it.each([
    ['DO_NOT_TRACK', { DO_NOT_TRACK: '1' }],
    ['SIM_TELEMETRY_DISABLED', { SIM_TELEMETRY_DISABLED: '1' }],
  ])('reports nothing when %s is set', async (_name, env) => {
    const { telemetry, program, send, write } = harness({ env, stderrIsTty: true })

    await run(program, ['workflows', 'list'])
    telemetry.complete({ exitCode: 0 })

    expect(send).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('reports nothing after sim telemetry disable', async () => {
    writeTelemetryState({ ...loadTelemetryState(statePath), enabled: false }, statePath)
    const { telemetry, program, send } = harness()

    await run(program, ['workflows', 'list'])
    telemetry.complete({ exitCode: 0 })

    expect(send).not.toHaveBeenCalled()
  })

  it('never touches the state file when reporting is switched off', async () => {
    const { telemetry, program } = harness({ env: { DO_NOT_TRACK: '1' }, stderrIsTty: true })

    await run(program, ['workflows', 'list'])
    telemetry.complete({ exitCode: 0 })

    expect(existsSync(statePath)).toBe(false)
  })
})
