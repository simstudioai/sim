import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimApiError } from '../../http/client'
import { buildGeneratedCommands } from '../../runtime/build'
import { contextMockFns, contextMockState } from '../../test/context-mock'
import { attachWorkflowSourceApply, attachWorkflowSourceCreate } from './workflow-source-apply'

const prompt = vi.hoisted(() => ({ question: vi.fn() }))

vi.mock('../../context', async () => (await import('../../test/context-mock')).contextMock)
vi.mock('node:readline/promises', () => ({
  createInterface: () => ({ question: prompt.question, close: () => {} }),
}))

const { mockRequest: request } = contextMockFns

const WORKFLOW_ID = '00000000-0000-4000-8000-00000000000a'
const WORKSPACE_ID = 'ws_local'
const APPLY_PATH = `/api/v2/workflows/${WORKFLOW_ID}/source`
const CREATE_PATH = `/api/v2/workspaces/${WORKSPACE_ID}/workflows/source`
const BASE = {
  workflowId: WORKFLOW_ID,
  workspaceId: WORKSPACE_ID,
  fingerprint: 'sf1:a',
  catalogHash: 'h',
}
const LOCK = { version: 1, blocks: {}, variables: {} }
const ENTRY = "// @sim-sdk 1\nexport default workflow('W', () => {})\n"

function outcome(overrides: { dryRun?: boolean; diagnostics?: unknown[] } = {}) {
  const dryRun = overrides.dryRun ?? false
  return {
    data: {
      workflowId: WORKFLOW_ID,
      workspaceId: WORKSPACE_ID,
      dryRun,
      applied: !dryRun,
      diff: {
        noop: false,
        blocks: { added: [{ id: 'b-1', key: 'start' }], removed: [], renamed: [], modified: [] },
        edges: { added: 1, removed: 0 },
        variables: { added: [], removed: [], modified: [] },
      },
      diagnostics: overrides.diagnostics ?? [],
      fingerprint: 'sf1:b',
      files: { 'workflow.ts': `${ENTRY}// stored\n` },
      lock: LOCK,
      base: { ...BASE, fingerprint: 'sf1:b' },
      mintedIds: {},
      notes: [],
      needsRedeployment: true,
    },
  }
}

function program(): Command {
  const root = new Command('sim')
  for (const command of buildGeneratedCommands()) root.addCommand(command)
  const workflows = root.commands.find((command) => command.name() === 'workflows')
  const sourceGroup = workflows?.commands.find((command) => command.name() === 'source')
  if (!sourceGroup) throw new Error('workflows source group missing')
  attachWorkflowSourceApply(sourceGroup)
  attachWorkflowSourceCreate(sourceGroup)
  const override = (command: Command) => {
    command.exitOverride()
    command.commands.forEach(override)
  }
  override(root)
  return root
}

async function apply(...argv: string[]): Promise<void> {
  await program().parseAsync(['node', 'sim', 'workflows', 'source', 'apply', ...argv])
}

async function create(...argv: string[]): Promise<void> {
  await program().parseAsync(['node', 'sim', 'workflows', 'source', 'create', ...argv])
}

/** Runs with a person at the terminal (stdin and stderr both TTYs) or without one. */
function setTerminal(interactive: boolean) {
  Object.defineProperty(process.stdin, 'isTTY', { value: interactive, configurable: true })
  Object.defineProperty(process.stderr, 'isTTY', { value: interactive, configurable: true })
}

let dir: string
let stdinTty: boolean | undefined
let stderrTty: boolean | undefined

beforeEach(() => {
  contextMockState.output = 'json'
  request.mockReset()
  prompt.question.mockReset()
  stdinTty = process.stdin.isTTY
  stderrTty = process.stderr.isTTY
  dir = mkdtempSync(join(tmpdir(), 'sim-source-apply-'))
  mkdirSync(join(dir, '.sim'))
  writeFileSync(join(dir, 'workflow.ts'), ENTRY)
  writeFileSync(join(dir, '.sim/lock.json'), JSON.stringify(LOCK))
  writeFileSync(join(dir, '.sim/base.json'), JSON.stringify(BASE))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  Object.defineProperty(process.stdin, 'isTTY', { value: stdinTty, configurable: true })
  Object.defineProperty(process.stderr, 'isTTY', { value: stderrTty, configurable: true })
  process.exitCode = undefined
  rmSync(dir, { recursive: true, force: true })
})

function dryRunFlags() {
  return request.mock.calls.map((call) => call[1].query?.dryRun === true)
}

describe('sim workflows source apply', () => {
  it('refuses without --yes when nobody is at a terminal, sending nothing', async () => {
    setTerminal(false)

    const error = await apply(WORKFLOW_ID, '--dir', dir).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(SimApiError)
    expect((error as SimApiError).code).toBe('CONFIRMATION_REQUIRED')
    expect((error as SimApiError).message).toContain('--yes')
    expect(request).not.toHaveBeenCalled()
  })

  it('applies at once with --yes and saves what the server stored', async () => {
    setTerminal(false)
    request.mockResolvedValue(outcome())

    await apply(WORKFLOW_ID, '--dir', dir, '--yes')

    expect(dryRunFlags()).toEqual([false])
    expect(request.mock.calls[0][0]).toBe(APPLY_PATH)
    expect(readFileSync(join(dir, 'workflow.ts'), 'utf8')).toBe(`${ENTRY}// stored\n`)
    expect(prompt.question).not.toHaveBeenCalled()
  })

  it('never asks on a dry run, even at a terminal, and writes nothing', async () => {
    setTerminal(true)
    request.mockResolvedValue(outcome({ dryRun: true }))

    await apply(WORKFLOW_ID, '--dir', dir, '--dry-run')

    expect(dryRunFlags()).toEqual([true])
    expect(prompt.question).not.toHaveBeenCalled()
    expect(readFileSync(join(dir, 'workflow.ts'), 'utf8')).toBe(ENTRY)
  })

  it('at a terminal, shows the dry run and applies once the person confirms', async () => {
    setTerminal(true)
    request.mockImplementation(async (_path: string, options: { query?: { dryRun?: boolean } }) =>
      outcome({ dryRun: options.query?.dryRun === true })
    )
    prompt.question.mockResolvedValue('y')

    await apply(WORKFLOW_ID, '--dir', dir)

    expect(dryRunFlags()).toEqual([true, false])
    expect(prompt.question).toHaveBeenCalledTimes(1)
    expect(readFileSync(join(dir, 'workflow.ts'), 'utf8')).toBe(`${ENTRY}// stored\n`)
  })

  it('at a terminal, applies nothing when the person declines', async () => {
    setTerminal(true)
    request.mockResolvedValue(outcome({ dryRun: true }))
    prompt.question.mockResolvedValue('n')

    await expect(apply(WORKFLOW_ID, '--dir', dir)).rejects.toThrow('Nothing was applied')

    expect(dryRunFlags()).toEqual([true])
    expect(readFileSync(join(dir, 'workflow.ts'), 'utf8')).toBe(ENTRY)
  })

  it('at a terminal, does not ask when the dry run already found errors', async () => {
    setTerminal(true)
    request.mockResolvedValue(
      outcome({
        dryRun: true,
        diagnostics: [
          { code: 'E_UNKNOWN_PARAM', severity: 'error', message: 'Slack has no param x.' },
        ],
      })
    )

    await apply(WORKFLOW_ID, '--dir', dir)

    expect(prompt.question).not.toHaveBeenCalled()
    expect(dryRunFlags()).toEqual([true])
    expect(process.exitCode).toBe(1)
  })

  it('exits 7 when a dry run finds the source over a size limit', async () => {
    setTerminal(false)
    request.mockResolvedValue(
      outcome({
        dryRun: true,
        diagnostics: [
          { code: 'E_LIMIT_EXCEEDED', severity: 'error', message: 'workflow.ts is too large.' },
        ],
      })
    )

    await apply(WORKFLOW_ID, '--dir', dir, '--dry-run')

    expect(process.exitCode).toBe(7)
  })

  it('creates a workflow from the directory alone, then writes its lock files', async () => {
    setTerminal(false)
    rmSync(join(dir, '.sim'), { recursive: true })
    request.mockResolvedValue(outcome())

    await create('--dir', dir, '--folder', '/Ops', '--yes')

    expect(request.mock.calls[0][0]).toBe(CREATE_PATH)
    expect(request.mock.calls[0][1].body).toEqual({
      files: { 'workflow.ts': ENTRY },
      folderPath: '/Ops',
      provenance: { client: 'cli' },
    })
    expect(JSON.parse(readFileSync(join(dir, '.sim/base.json'), 'utf8')).fingerprint).toBe('sf1:b')
  })
})
