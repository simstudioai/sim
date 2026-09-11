import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimApiError } from '../http/client'
import { CLI_VERSION } from '../version'
import {
  COMMAND_EVENT,
  type CommandEventProperties,
  type CommandTelemetryOptions,
  createCommandTelemetry,
  FIRST_RUN_NOTICE,
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
  vi.unstubAllEnvs()
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
    isTty: false,
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
      $lib_version: CLI_VERSION,
      $process_person_profile: false,
      session_sequence: 1,
      surface: 'cli',
      command: 'workflows list',
      flags: expect.arrayContaining(['--limit', '--all', '--output']),
      arg_count: 0,
      exit_code: 0,
      duration_ms: 1432,
      cli_version: CLI_VERSION,
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

  it('ties commands on one device into a numbered session', async () => {
    const first = harness()
    await run(first.program, ['workflows', 'list'])
    first.telemetry.complete({ exitCode: 0 })

    const second = harness()
    await run(second.program, ['workflows', 'get', 'wf_1'])
    second.telemetry.complete({ exitCode: 0 })

    const [a, b] = [sentBy(first.send), sentBy(second.send)]
    expect(a.distinct_id).toBe(b.distinct_id)
    expect(a.properties.$session_id).toBe(b.properties.$session_id)
    expect(b.properties.session_sequence).toBe(2)
    expect(readTelemetryState(statePath)?.session?.sequence).toBe(2)
  })

  it('reports the coding agent driving the shell', async () => {
    const { telemetry, program, send } = harness({ env: { CLAUDECODE: '1' } })

    await run(program, ['workflows', 'list'])
    telemetry.complete({ exitCode: 0 })

    expect(sentBy(send).properties.coding_agent).toBe('claude-code')
  })

  it('shows the first-run notice on a terminal and does not report that run', async () => {
    const { telemetry, program, send, write } = harness({ isTty: true })

    await run(program, ['workflows', 'list'])
    telemetry.complete({ exitCode: 0 })

    expect(write).toHaveBeenCalledWith(FIRST_RUN_NOTICE)
    expect(send).not.toHaveBeenCalled()
    expect(readTelemetryState(statePath)?.noticeShownAt).toBe(NOW.toISOString())

    const next = harness({ isTty: true })
    await run(next.program, ['workflows', 'list'])
    next.telemetry.complete({ exitCode: 0 })

    expect(next.write).not.toHaveBeenCalled()
    expect(next.send).toHaveBeenCalledOnce()
  })

  it('shows no notice without a terminal or in CI, and still reports', async () => {
    const piped = harness({ isTty: false })
    await run(piped.program, ['workflows', 'list'])
    piped.telemetry.complete({ exitCode: 0 })

    expect(piped.write).not.toHaveBeenCalled()
    expect(piped.send).toHaveBeenCalledOnce()

    const ci = harness({ isTty: true, env: { CI: 'true' } })
    await run(ci.program, ['workflows', 'list'])
    ci.telemetry.complete({ exitCode: 0 })

    expect(ci.write).not.toHaveBeenCalled()
    expect(sentBy(ci.send).properties.is_ci).toBe(true)
  })

  it.each([
    ['DO_NOT_TRACK', { DO_NOT_TRACK: '1' }],
    ['SIM_TELEMETRY_DISABLED', { SIM_TELEMETRY_DISABLED: '1' }],
  ])('reports nothing when %s is set', async (_name, env) => {
    const { telemetry, program, send, write } = harness({ env, isTty: true })

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

  it('reports nothing from a build with no destination', async () => {
    const { telemetry, program, send, write } = harness({
      ingestTarget: () => undefined,
      isTty: true,
    })

    await run(program, ['workflows', 'list'])
    telemetry.complete({ exitCode: 0 })

    expect(send).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('never reports the telemetry commands themselves', async () => {
    const { telemetry, program, send } = harness()

    await run(program, ['telemetry', 'disable'])
    telemetry.complete({ exitCode: 0 })

    expect(send).not.toHaveBeenCalled()
  })

  it('reports from the process exit event, once, with the real exit code', async () => {
    const { telemetry, program, send, exit } = harness()

    await run(program, ['workflows', 'list'])
    exit(3)
    exit(3)
    telemetry.complete({ exitCode: 0 })

    expect(send).toHaveBeenCalledOnce()
    expect(sentBy(send).properties.exit_code).toBe(3)
  })

  it('never touches the state file when reporting is switched off', async () => {
    const { telemetry, program } = harness({ env: { DO_NOT_TRACK: '1' }, isTty: true })

    await run(program, ['workflows', 'list'])
    telemetry.complete({ exitCode: 0 })

    expect(existsSync(statePath)).toBe(false)
  })

  it('reports nothing when no command ran', () => {
    const { telemetry, send } = harness()

    telemetry.complete({ exitCode: 1, error: new Error('usage') })

    expect(send).not.toHaveBeenCalled()
  })
})
