import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { toRecord } from '@sim/utils/object'
import { compileWorkflow } from '@sim/workflow-code'
import { fingerprintOf } from '@sim/workspace-code'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimApiError } from '../../http/client'
import { buildGeneratedCommands } from '../../runtime/build'
import { cacheCatalogText } from '../../test/catalog-cache'
import { contextMockFns, contextMockState } from '../../test/context-mock'
import { digest } from './source-dir'
import { TSCONFIG_MARKER, WORKSPACE_TYPES_FILE } from './source-tree'
import { attachWorkflowSourceApply, attachWorkflowSourceCreate } from './workflow-source-apply'

const prompt = vi.hoisted(() => ({
  question: vi.fn(),
  /** The open readline interface, to end its input as Ctrl-D does. */
  open: null as import('node:events').EventEmitter | null,
}))

vi.mock('../../context', async () => (await import('../../test/context-mock')).contextMock)
vi.mock('node:readline/promises', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    createInterface: () => {
      const readline = Object.assign(new EventEmitter(), {
        question: prompt.question,
        close: () => readline.emit('close'),
      })
      prompt.open = readline
      return readline
    },
  }
})

const { mockRequest: request } = contextMockFns

/** A real catalog projected from registry blocks, shared with the SDK's own type checks. */
const FIXTURE_CATALOG = join(__dirname, '../../../../workflow-sdk/test/fixtures/catalog.json')

const WORKFLOW_ID = '00000000-0000-4000-8000-00000000000a'
const WORKSPACE_ID = 'ws_local'
const APPLY_PATH = `/api/v2/workflows/${WORKFLOW_ID}/source`
const BASE = {
  workflowId: WORKFLOW_ID,
  workspaceId: WORKSPACE_ID,
  fingerprint: 'sf1:a',
  catalogHash: 'h',
}
const LOCK = { version: 1, blocks: {}, variables: {} }
const ENTRY = "// @sim-sdk 1\nexport default workflow('W', () => {})\n"

function outcome(overrides: { dryRun?: boolean; diagnostics?: unknown[]; notes?: string[] } = {}) {
  const dryRun = overrides.dryRun ?? false
  return {
    data: {
      workflowId: WORKFLOW_ID,
      workspaceId: WORKSPACE_ID,
      dryRun,
      applied: !dryRun,
      diff: {
        noop: false,
        blocks: {
          added: [{ id: 'b-1', key: 'start', type: 'start_trigger' }] as Array<{
            id: string
            key: string
            type: string
          }>,
          removed: [] as Array<{ id: string; key: string; type: string }>,
          renamed: [],
          modified: [] as Array<{ id: string; key: string; fields: string[] }>,
        },
        edges: { added: 1, removed: 0 },
        variables: { added: [] as string[], removed: [] as string[], modified: [] as string[] },
      },
      diagnostics: overrides.diagnostics ?? [],
      files: { 'workflow.ts': `${ENTRY}// stored\n` },
      lock: LOCK,
      base: { ...BASE, fingerprint: 'sf1:b' },
      mintedIds: {},
      notes: overrides.notes ?? [],
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

/** Stdout as the one JSON document `--output json` promises. */
function stdoutJson(): Record<string, unknown> {
  const calls = vi.mocked(console.log).mock.calls
  expect(calls).toHaveLength(1)
  return JSON.parse(calls[0].join(' '))
}

function stderrLines(): string[] {
  return vi.mocked(console.error).mock.calls.map((call) => call.join(' '))
}

/** The file paths the apply sent, beside the entry file. */
function sentCodeFiles(): string[] {
  const body = request.mock.calls[0][1].body as { files: Record<string, string> }
  return Object.keys(body.files)
    .filter((path) => path !== 'workflow.ts')
    .sort()
}

function dryRunFlags() {
  return request.mock.calls.map((call) => call[1].query?.dryRun === true)
}

describe('sim workflows source apply', () => {
  it('without --yes and nobody at a terminal, prints the plan, writes nothing and exits 14', async () => {
    setTerminal(false)
    request.mockResolvedValue(outcome({ dryRun: true }))

    await apply(WORKFLOW_ID, '--dir', dir, '--allow-delete')

    expect(dryRunFlags()).toEqual([true])
    expect(process.exitCode).toBe(14)
    expect(readFileSync(join(dir, 'workflow.ts'), 'utf8')).toBe(ENTRY)
    expect(stdoutJson()).toMatchObject({
      applied: false,
      dryRun: true,
      next: { command: `sim workflows source apply --dir ${dir} --allow-delete --yes` },
      blocksAdded: 1,
    })
    // The JSON on stdout is the plan: stderr does not repeat it.
    expect(stderrLines().join('\n')).not.toContain('Blocks:')
  })

  it('prints the whole next command in a table, never clipping the flag it names', async () => {
    setTerminal(false)
    contextMockState.output = 'table'
    const deep = join(dir, 'a-directory-name-long-enough-that-the-next-command-runs-past-any-clamp')
    mkdirSync(join(deep, '.sim'), { recursive: true })
    writeFileSync(join(deep, 'workflow.ts'), ENTRY)
    writeFileSync(join(deep, '.sim/lock.json'), JSON.stringify(LOCK))
    writeFileSync(join(deep, '.sim/base.json'), JSON.stringify(BASE))
    request.mockResolvedValue(outcome({ dryRun: true }))

    await apply(WORKFLOW_ID, '--dir', deep, '--allow-delete')

    const lines = vi.mocked(console.log).mock.calls.map((call) => call.join(' '))
    expect(lines.find((line) => line.includes('next:'))).toContain(
      `sim workflows source apply --dir ${deep} --allow-delete --yes`
    )
    expect(process.exitCode).toBe(14)
  })

  it('applies the current directory when --dir is left out, as check and status do', async () => {
    setTerminal(false)
    request.mockResolvedValue(outcome({ dryRun: true }))
    const cwd = process.cwd()
    process.chdir(dir)
    try {
      await apply('--dry-run')
    } finally {
      process.chdir(cwd)
    }

    expect(request.mock.calls[0][0]).toBe(APPLY_PATH)
    expect(request.mock.calls[0][1].body.files['workflow.ts']).toBe(ENTRY)
  })

  it('without --yes, exits with the refusal and names no next step when the plan has errors', async () => {
    setTerminal(false)
    request.mockResolvedValue(
      outcome({
        dryRun: true,
        diagnostics: [{ code: 'E_UNKNOWN_PARAM', severity: 'error', message: 'No param x.' }],
      })
    )

    await apply(WORKFLOW_ID, '--dir', dir)

    expect(process.exitCode).toBe(1)
    expect(stdoutJson()).not.toHaveProperty('next')
  })

  it('plans a create without --yes and creates nothing', async () => {
    setTerminal(false)
    rmSync(join(dir, '.sim/base.json'))
    request.mockResolvedValue(outcome({ dryRun: true }))

    await program().parseAsync(['node', 'sim', 'workflows', 'source', 'create', '--dir', dir])

    expect(dryRunFlags()).toEqual([true])
    expect(process.exitCode).toBe(14)
    expect(stdoutJson()).toMatchObject({
      next: {
        command: `sim workflows source create --dir ${dir} --workspace ${WORKSPACE_ID} --yes`,
      },
    })
  })

  it('with --yes, prints the summary of what it applied for a person, and only the JSON for a machine', async () => {
    setTerminal(false)
    request.mockResolvedValue(outcome())

    await apply(WORKFLOW_ID, '--dir', dir, '--yes')

    expect(dryRunFlags()).toEqual([false])
    expect(stderrLines().join('\n')).not.toContain('Blocks:')
    expect(stdoutJson()).toMatchObject({ applied: true, blocksAdded: 1 })

    vi.mocked(console.error).mockClear()
    contextMockState.output = 'text'
    request.mockResolvedValue(outcome())
    await apply(WORKFLOW_ID, '--dir', dir, '--yes')
    expect(stderrLines().join('\n')).toContain('Blocks: 1 added, 0 removed')
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

  it('applies to the workflow .sim/base.json names when no workflow id is given', async () => {
    setTerminal(false)
    request.mockResolvedValue(outcome())

    await apply('--dir', dir, '--yes')

    expect(request.mock.calls.map((call) => call[0])).toEqual([APPLY_PATH])
    expect(readFileSync(join(dir, 'workflow.ts'), 'utf8')).toBe(`${ENTRY}// stored\n`)
  })

  it('refuses a workflow id other than the one .sim/base.json names, sending nothing', async () => {
    setTerminal(false)

    const error = await apply('00000000-0000-4000-8000-0000000000ff', '--dir', dir, '--yes').catch(
      (caught: unknown) => caught
    )

    expect((error as SimApiError).code).toBe('SOURCE_WORKFLOW_MISMATCH')
    expect(request).not.toHaveBeenCalled()
  })

  it('refuses a workspace source directory by its kind before reading a lock', async () => {
    setTerminal(false)
    rmSync(join(dir, '.sim/lock.json'))
    writeFileSync(
      join(dir, '.sim/base.json'),
      JSON.stringify({ version: 1, workspaceId: WORKSPACE_ID, resources: {} })
    )

    await expect(apply('--dir', dir, '--yes')).rejects.toMatchObject({
      code: 'SOURCE_DIR_KIND_MISMATCH',
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('points tsconfig.json at a block the applied source added, from the cached catalog', async () => {
    setTerminal(false)
    vi.stubEnv('SIM_CONFIG_DIR', join(dir, 'config'))
    cacheCatalogText(join(dir, 'config'), WORKSPACE_ID, readFileSync(FIXTURE_CATALOG, 'utf8'))
    writeFileSync(join(dir, 'tsconfig.json'), `${TSCONFIG_MARKER}\n{}\n`)
    const stored = outcome()
    stored.data.files = { 'workflow.ts': `${ENTRY}// slack.sendMessage('Post', {})\n` }
    request.mockResolvedValue(stored)

    await apply('--dir', dir, '--yes')

    const [, ...json] = readFileSync(join(dir, 'tsconfig.json'), 'utf8').split('\n')
    expect(JSON.parse(json.join('\n')).include).toContain('.sim/sdk/blocks/slack_v2.d.ts')
  })

  it('never asks on a dry run, even at a terminal, and writes nothing', async () => {
    setTerminal(true)
    request.mockResolvedValue(outcome({ dryRun: true }))

    await apply(WORKFLOW_ID, '--dir', dir, '--dry-run')

    expect(dryRunFlags()).toEqual([true])
    expect(prompt.question).not.toHaveBeenCalled()
    expect(readFileSync(join(dir, 'workflow.ts'), 'utf8')).toBe(ENTRY)
  })

  it('neither reads nor rewrites the workspace types on a dry run', async () => {
    mkdirSync(join(dir, '.sim/sdk'), { recursive: true })
    writeFileSync(join(dir, WORKSPACE_TYPES_FILE), '// types the last get wrote\n')
    writeFileSync(join(dir, '.sim/sdk/workspace.manifest.json'), '{}\n')
    request.mockResolvedValue(outcome({ dryRun: true }))

    await apply(WORKFLOW_ID, '--dir', dir, '--dry-run')

    expect(request.mock.calls.map((call) => call[0])).not.toContainEqual(
      expect.stringContaining('/source/resources')
    )
    expect(readFileSync(join(dir, WORKSPACE_TYPES_FILE), 'utf8')).toBe(
      '// types the last get wrote\n'
    )
  })

  it('neither reads nor rewrites the workspace types on a plan', async () => {
    setTerminal(false)
    mkdirSync(join(dir, '.sim/sdk'), { recursive: true })
    writeFileSync(join(dir, WORKSPACE_TYPES_FILE), '// types the last get wrote\n')
    writeFileSync(join(dir, '.sim/sdk/workspace.manifest.json'), '{}\n')
    request.mockResolvedValue(outcome({ dryRun: true }))

    await apply(WORKFLOW_ID, '--dir', dir)

    expect(dryRunFlags()).toEqual([true])
    expect(request.mock.calls.map((call) => call[0])).not.toContainEqual(
      expect.stringContaining('/source/resources')
    )
    expect(readFileSync(join(dir, WORKSPACE_TYPES_FILE), 'utf8')).toBe(
      '// types the last get wrote\n'
    )
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
    // Refused at admission, a 429 left nothing written, so the client may resend either request.
    expect(request.mock.calls.map((call) => call[1].retryRateLimited)).toEqual([true, true])
  })

  it('at a terminal, applies nothing when the person declines', async () => {
    setTerminal(true)
    request.mockResolvedValue(outcome({ dryRun: true }))
    prompt.question.mockResolvedValue('n')

    await expect(apply(WORKFLOW_ID, '--dir', dir)).rejects.toThrow('Nothing was applied')

    expect(dryRunFlags()).toEqual([true])
    expect(readFileSync(join(dir, 'workflow.ts'), 'utf8')).toBe(ENTRY)
  })

  it.each([
    [
      'Node closes the prompt',
      () => {
        queueMicrotask(() => prompt.open?.emit('close'))
        return new Promise(() => {})
      },
    ],
    [
      'Bun aborts the question',
      async () => {
        throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
      },
    ],
  ])(
    'at a terminal, applies nothing when input ends at the prompt (%s)',
    async (_runtime, answer) => {
      setTerminal(true)
      request.mockResolvedValue(outcome({ dryRun: true }))
      prompt.question.mockImplementation(answer)

      await expect(apply(WORKFLOW_ID, '--dir', dir)).rejects.toMatchObject({
        code: 'CANCELLED',
        exitCode: 1,
        message: 'Nothing was applied.',
      })

      expect(dryRunFlags()).toEqual([true])
      expect(readFileSync(join(dir, 'workflow.ts'), 'utf8')).toBe(ENTRY)
    }
  )

  it.each([
    [
      'table',
      'The workflow source has 1 error(s); nothing was written. Each finding is printed above.',
    ],
    ['json', 'The workflow source has 1 error(s); nothing was written. See details.diagnostics.'],
  ] as const)('names where the findings of a refusal are in %s output', async (output, message) => {
    contextMockState.output = output
    setTerminal(false)
    request.mockRejectedValue(
      new SimApiError(
        'The workflow source has 1 error(s); nothing was written. See details.diagnostics.',
        400,
        'BAD_REQUEST',
        {
          code: 'SOURCE_REJECTED',
          diagnostics: [
            {
              code: 'E_PARSE',
              severity: 'error',
              message: 'Unexpected token.',
              file: 'workflow.ts',
              line: 2,
              column: 1,
            },
          ],
        }
      )
    )

    await expect(apply(WORKFLOW_ID, '--dir', dir, '--yes')).rejects.toMatchObject({ message })
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

  it.each([
    [['E_APPLY_LOCKED'], 6],
    [['E_LIMIT_EXCEEDED', 'E_APPLY_STALE'], 5],
    [['E_LIMIT_EXCEEDED', 'E_APPLY_LOCKED'], 6],
  ])('exits a dry run refused with %j as the workspace apply does', async (codes, exitCode) => {
    setTerminal(false)
    request.mockResolvedValue(
      outcome({
        dryRun: true,
        diagnostics: codes.map((code) => ({ code, severity: 'error', message: code })),
      })
    )

    await apply(WORKFLOW_ID, '--dir', dir, '--dry-run')

    expect(process.exitCode).toBe(exitCode)
  })

  it('names each modified block and its changed fields in the result and the preview', async () => {
    setTerminal(true)
    const modified = outcome({ dryRun: true })
    modified.data.diff.blocks.added = []
    modified.data.diff.blocks.modified = [{ id: 'b-2', key: 'eachticket', fields: ['subflow'] }]
    request.mockResolvedValue(modified)
    prompt.question.mockResolvedValue('n')

    await apply(WORKFLOW_ID, '--dir', dir).catch(() => {})
    await apply(WORKFLOW_ID, '--dir', dir, '--dry-run')

    expect(stderrLines().some((line) => line.includes('Modified: eachticket (subflow)'))).toBe(true)
    const printed = vi.mocked(console.log).mock.calls.at(-1)?.join(' ') ?? ''
    expect(JSON.parse(printed)).toMatchObject({
      blocksModified: 1,
      modified: [{ block: 'eachticket', fields: ['subflow'] }],
    })
  })

  it('names each added and removed block with its type in the result and the preview', async () => {
    setTerminal(true)
    const changed = outcome({ dryRun: true })
    changed.data.diff.blocks.added = [{ id: 'b-3', key: 'bang', type: 'function' }]
    changed.data.diff.blocks.removed = [{ id: 'b-2', key: 'boom', type: 'function' }]
    request.mockResolvedValue(changed)
    prompt.question.mockResolvedValue('n')

    await apply(WORKFLOW_ID, '--dir', dir).catch(() => {})
    await apply(WORKFLOW_ID, '--dir', dir, '--dry-run')

    expect(stderrLines().some((line) => line.includes('Added: bang (function)'))).toBe(true)
    expect(stderrLines().some((line) => line.includes('Removed: boom (function)'))).toBe(true)
    const printed = vi.mocked(console.log).mock.calls.at(-1)?.join(' ') ?? ''
    expect(JSON.parse(printed)).toMatchObject({
      added: [{ block: 'bang', type: 'function' }],
      removed: [{ block: 'boom', type: 'function' }],
    })
  })

  it('names each changed variable in the result and the preview', async () => {
    setTerminal(true)
    const changed = outcome({ dryRun: true })
    changed.data.diff.variables = { added: ['retries'], removed: [], modified: ['threshold'] }
    request.mockResolvedValue(changed)
    prompt.question.mockResolvedValue('n')

    await apply(WORKFLOW_ID, '--dir', dir).catch(() => {})
    await apply(WORKFLOW_ID, '--dir', dir, '--dry-run')

    expect(
      stderrLines().some((line) => line.includes('Variables: added retries; modified threshold'))
    ).toBe(true)
    const printed = vi.mocked(console.log).mock.calls.at(-1)?.join(' ') ?? ''
    expect(JSON.parse(printed)).toMatchObject({
      variables: { added: ['retries'], removed: [], modified: ['threshold'] },
    })
  })

  it('prints the modified blocks readably in text output', async () => {
    contextMockState.output = 'text'
    const modified = outcome({ dryRun: true })
    modified.data.diff.blocks.modified = [{ id: 'b-2', key: 'eachticket', fields: ['subflow'] }]
    request.mockResolvedValue(modified)

    await apply(WORKFLOW_ID, '--dir', dir, '--dry-run')

    const lines = vi.mocked(console.log).mock.calls.map((call) => call.join(' '))
    expect(lines.find((line) => line.startsWith('modified\t'))).toBe(
      'modified\t[{"block":"eachticket","fields":["subflow"]}]'
    )
  })

  it('prints no workflow id for a create dry run, since nothing was stored under it', async () => {
    setTerminal(false)
    rmSync(join(dir, '.sim/base.json'))
    request.mockResolvedValue(outcome({ dryRun: true }))

    await program().parseAsync([
      'node',
      'sim',
      'workflows',
      'source',
      'create',
      '--dir',
      dir,
      '--dry-run',
    ])

    const printed = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)?.join(' ') ?? '{}')
    expect(printed).toMatchObject({
      dryRun: true,
      created: [{ kind: 'workflow' }, { kind: 'block', key: 'start' }],
    })
    expect(printed).not.toHaveProperty('workflowId')
    expect(JSON.stringify(printed.created)).not.toContain('"id"')
  })

  it('hides autolayout infos unless --verbose, folds infos into one line per code and keeps frames on warnings', async () => {
    setTerminal(false)
    contextMockState.output = 'text'
    const layout = (key: string, line: number) => ({
      code: 'I_MAT_NEEDS_LAYOUT',
      severity: 'info',
      message: `Block "${key}" has no stored or lock position; it is placed by autolayout`,
      file: 'workflow.ts',
      line,
      column: 3,
      frame: `> ${line} |   const ${key} = agent(...)`,
    })
    const warning = {
      code: 'W_REQUIRED_MISSING',
      severity: 'warning',
      message: 'apiKey is required.',
      file: 'workflow.ts',
      line: 9,
      column: 5,
      frame: '> 9 |   apiKey: undefined',
    }
    request.mockResolvedValue(
      outcome({
        dryRun: true,
        diagnostics: [layout('a', 4), layout('b', 6), layout('c', 8), warning],
      })
    )

    await apply(WORKFLOW_ID, '--dir', dir, '--dry-run')
    expect(stderrLines().filter((line) => line.includes('I_MAT_NEEDS_LAYOUT'))).toEqual([])
    vi.mocked(console.error).mockClear()

    await apply(WORKFLOW_ID, '--dir', dir, '--dry-run', '--verbose')

    const lines = stderrLines()
    const layoutLines = lines.filter((line) => line.includes('I_MAT_NEEDS_LAYOUT'))
    expect(layoutLines).toHaveLength(1)
    expect(layoutLines[0]).toContain('3 blocks')
    expect(layoutLines[0]).not.toContain('> 4 |')
    expect(
      lines.some((line) => line.includes('W_REQUIRED_MISSING') && line.includes('> 9 |'))
    ).toBe(true)
  })

  it('prints every note on a dry run, so a kept name or a dropped tool is never silent', async () => {
    setTerminal(false)
    contextMockState.output = 'text'
    const note = "The workflow name 'New' differs from the stored one and was not changed."
    request.mockResolvedValue(outcome({ dryRun: true, notes: [note] }))

    await apply(WORKFLOW_ID, '--dir', dir, '--dry-run')

    expect(stderrLines()).toContain(`note: ${note}`)
  })

  it('lists notes apart from warnings in the JSON result, and prints none on stderr', async () => {
    setTerminal(false)
    request.mockResolvedValue(outcome({ dryRun: true, notes: ['a kept name'] }))

    await apply(WORKFLOW_ID, '--dir', dir, '--dry-run')

    expect(stdoutJson()).toMatchObject({ warnings: 0, notes: ['a kept name'] })
    expect(stderrLines()).toEqual([])
  })

  it('at a terminal, prints the notes of the preview and of the applied write', async () => {
    setTerminal(true)
    contextMockState.output = 'text'
    request.mockImplementation(async (_path: string, options: { query?: { dryRun?: boolean } }) =>
      outcome({
        dryRun: options.query?.dryRun === true,
        notes: [options.query?.dryRun === true ? 'previewed note' : 'applied note'],
      })
    )
    prompt.question.mockResolvedValue('y')

    await apply(WORKFLOW_ID, '--dir', dir)

    expect(stderrLines()).toEqual(
      expect.arrayContaining(['note: previewed note', 'note: applied note'])
    )
  })

  it('at a terminal, prints a warning and a note the preview showed once, not again on the write', async () => {
    setTerminal(true)
    contextMockState.output = 'text'
    const warning = {
      code: 'W_REQUIRED_MISSING',
      severity: 'warning',
      message: 'apiKey is required.',
      file: 'workflow.ts',
      line: 9,
      column: 5,
    }
    request.mockImplementation(async (_path: string, options: { query?: { dryRun?: boolean } }) =>
      outcome({
        dryRun: options.query?.dryRun === true,
        diagnostics: [warning],
        notes: ['kept note'],
      })
    )
    prompt.question.mockResolvedValue('y')

    await apply(WORKFLOW_ID, '--dir', dir)

    const lines = stderrLines()
    expect(lines.filter((line) => line.includes('W_REQUIRED_MISSING'))).toHaveLength(1)
    expect(lines.filter((line) => line === 'note: kept note')).toHaveLength(1)
  })

  const STALE = {
    code: 'E_APPLY_STALE',
    severity: 'error',
    message: 'The workflow changed since this directory was read.',
  }

  it('puts each finding of a dry run in the JSON on stdout', async () => {
    setTerminal(false)
    request.mockResolvedValue(outcome({ dryRun: true, diagnostics: [STALE] }))

    await apply(WORKFLOW_ID, '--dir', dir, '--dry-run')

    expect(stdoutJson()).toMatchObject({
      errors: 1,
      diagnostics: [{ code: 'E_APPLY_STALE', severity: 'error', message: STALE.message }],
    })
  })

  describe('findings and results an agent reads', () => {
    const untyped = (line: number) => ({
      code: 'W_JSON_REF_UNTYPED',
      severity: 'warning',
      message: `Nothing declares the type of <score.result.n${line}>.`,
      file: 'workflow.ts',
      line,
      column: 7,
      frame: `> ${line} |   n: score.result.n${line},`,
      hint: 'Leave it bare when it holds a number.',
    })
    const layout = {
      code: 'I_MAT_NEEDS_LAYOUT',
      severity: 'info',
      message: 'Block "start" is placed by autolayout',
      file: 'workflow.ts',
      line: 3,
      column: 3,
    }

    it('with --output json, prints findings only in the JSON on stdout, never as frames on stderr', async () => {
      setTerminal(false)
      request.mockResolvedValue(outcome({ dryRun: true, diagnostics: [untyped(4)] }))

      await apply(WORKFLOW_ID, '--dir', dir, '--dry-run')

      expect(stdoutJson()).toMatchObject({ diagnostics: [{ code: 'W_JSON_REF_UNTYPED' }] })
      expect(stderrLines().join('\n')).not.toContain('W_JSON_REF_UNTYPED')
    })

    it('leaves info findings out of the JSON unless --verbose', async () => {
      setTerminal(false)
      request.mockResolvedValue(outcome({ dryRun: true, diagnostics: [layout, untyped(4)] }))

      await apply(WORKFLOW_ID, '--dir', dir, '--dry-run')
      expect(stdoutJson().diagnostics).toEqual([expect.objectContaining({ severity: 'warning' })])

      vi.mocked(console.log).mockClear()
      await apply(WORKFLOW_ID, '--dir', dir, '--dry-run', '--verbose')
      expect(stdoutJson().diagnostics).toEqual([
        expect.objectContaining({ code: 'I_MAT_NEEDS_LAYOUT' }),
        expect.objectContaining({ code: 'W_JSON_REF_UNTYPED' }),
      ])
    })

    it('without --verbose, says the truncation marker leaves out the infos it hides too', async () => {
      setTerminal(false)
      const truncated = {
        code: 'I_FINDINGS_TRUNCATED',
        severity: 'info',
        message: 'There are 140 findings; 40 more are left out.',
      }
      request.mockResolvedValue(
        outcome({ dryRun: true, diagnostics: [layout, { ...layout, line: 4 }, truncated] })
      )

      await apply(WORKFLOW_ID, '--dir', dir, '--dry-run')

      expect(stdoutJson().diagnostics).toEqual([
        {
          ...truncated,
          message:
            'There are 140 findings; 40 more are left out. 2 info findings listed are hidden too; pass --verbose to see them.',
        },
      ])
    })

    it('in a display format, prints the first warning of a code whole and the rest on one line', async () => {
      setTerminal(false)
      contextMockState.output = 'text'
      request.mockResolvedValue(
        outcome({ dryRun: true, diagnostics: [4, 5, 6, 7].map((line) => untyped(line)) })
      )

      await apply(WORKFLOW_ID, '--dir', dir, '--dry-run')

      const lines = stderrLines()
      expect(lines.filter((line) => line.includes('> '))).toHaveLength(1)
      expect(lines).toContain(
        '  3 more W_JSON_REF_UNTYPED like it: workflow.ts:5:7 (Nothing declares the type of <score.result.n5>.), workflow.ts:6:7 (Nothing declares the type of <score.result.n6>.), workflow.ts:7:7 (Nothing declares the type of <score.result.n7>.)'
      )
    })

    it('in a display format, names each collapsed warning by location alone when they say the same', async () => {
      setTerminal(false)
      contextMockState.output = 'text'
      request.mockResolvedValue(
        outcome({
          dryRun: true,
          diagnostics: [4, 5].map((line) => ({ ...untyped(line), message: 'Same words.' })),
        })
      )

      await apply(WORKFLOW_ID, '--dir', dir, '--dry-run')

      expect(stderrLines()).toContain('  1 more W_JSON_REF_UNTYPED like it: workflow.ts:5:7')
    })

    it('with --output json and --verbose, keeps info findings in a refusal too', async () => {
      setTerminal(false)
      request.mockRejectedValue(
        new SimApiError('Refused. See details.diagnostics.', 422, 'SOURCE_REJECTED', {
          diagnostics: [layout, STALE],
        })
      )

      const refused = await apply(WORKFLOW_ID, '--dir', dir, '--yes', '--verbose').then(
        () => null,
        (error: unknown) => error as SimApiError
      )

      expect(toRecord(refused?.details).diagnostics).toEqual([
        expect.objectContaining({ code: 'I_MAT_NEEDS_LAYOUT' }),
        expect.objectContaining({ code: 'E_APPLY_STALE' }),
      ])
    })

    it('lists the workflow and blocks a create made, with their ids', async () => {
      setTerminal(false)
      vi.stubEnv('SIM_CONFIG_DIR', join(dir, 'config'))
      rmSync(join(dir, '.sim/base.json'))
      const catalog = JSON.parse(readFileSync(FIXTURE_CATALOG, 'utf8'))
      request.mockImplementation(async (path: string) => {
        if (path.endsWith('/workflows/source/catalog')) return { data: catalog }
        if (path.endsWith('/workflows/source/resources')) {
          return {
            data: {
              workspaceId: WORKSPACE_ID,
              tables: [],
              knowledgeBases: [],
              credentials: [],
              workflows: [],
              env: [],
              truncated: false,
            },
          }
        }
        return outcome()
      })

      await program().parseAsync([
        'node',
        'sim',
        'workflows',
        'source',
        'create',
        '--dir',
        dir,
        '--yes',
      ])

      expect(stdoutJson()).toMatchObject({
        workflowId: WORKFLOW_ID,
        created: [
          { kind: 'workflow', id: WORKFLOW_ID },
          { kind: 'block', key: 'start', id: 'b-1' },
        ],
      })
    })

    it('names what an apply created on one line in a display format', async () => {
      setTerminal(false)
      contextMockState.output = 'text'
      request.mockResolvedValue(outcome())

      await apply(WORKFLOW_ID, '--dir', dir, '--yes')

      expect(vi.mocked(console.log).mock.calls.map((call) => call.join(' '))).toContain(
        'created\tblock start (b-1)'
      )
    })
  })

  describe('--deploy', () => {
    const DEPLOY_PATH = `/api/v2/workflows/${WORKFLOW_ID}/deploy`
    const deployed = {
      data: {
        id: WORKFLOW_ID,
        isDeployed: true,
        deployedAt: null,
        warnings: [],
        activeDeployment: null,
        latestDeploymentAttempt: null,
        version: 4,
        lint: null,
      },
    }

    const STATUS_PATH = `/api/v2/workflows/${WORKFLOW_ID}/deployment`
    const HOOK_URL = 'https://sim.example/api/webhooks/trigger/abc'
    /** A deployment status serving one webhook from the block `b-hook`. */
    const liveStatus = {
      data: {
        ...deployed.data,
        needsRedeployment: false,
        isPublicApi: false,
        webhooks: [{ blockId: 'b-hook', provider: 'generic', url: HOOK_URL }],
      },
    }
    /** An apply whose stored lock binds `b-hook` as the block `leadin`, const `hook`. */
    const withHookLock = () => {
      const answer = outcome()
      answer.data.lock = {
        ...LOCK,
        blocks: { leadin: { id: 'b-hook', parent: null, ident: 'hook', order: 0 } },
      } as typeof LOCK
      return answer
    }

    it('names each webhook URL the deploy made live, by its block and const', async () => {
      setTerminal(false)
      request.mockImplementation(async (path: string) =>
        path === DEPLOY_PATH ? deployed : path === STATUS_PATH ? liveStatus : withHookLock()
      )

      await apply(WORKFLOW_ID, '--dir', dir, '--yes', '--deploy')

      expect(request.mock.calls.map((call) => call[0])).toEqual([
        APPLY_PATH,
        DEPLOY_PATH,
        STATUS_PATH,
      ])
      expect(stdoutJson()).toMatchObject({ urls: [{ block: 'leadin (hook)', url: HOOK_URL }] })

      vi.mocked(console.log).mockClear()
      contextMockState.output = 'text'
      await apply(WORKFLOW_ID, '--dir', dir, '--yes', '--deploy')
      expect(vi.mocked(console.log).mock.calls.map((call) => call.join(' '))).toContain(
        `urls\tleadin (hook) ${HOOK_URL}`
      )
    })

    it('deploys through the deploy operation once the apply is saved', async () => {
      setTerminal(false)
      request.mockImplementation(async (path: string) =>
        path === DEPLOY_PATH ? deployed : path === STATUS_PATH ? liveStatus : outcome()
      )

      await apply(WORKFLOW_ID, '--dir', dir, '--yes', '--deploy')

      expect(request.mock.calls.map((call) => call[0])).toEqual([
        APPLY_PATH,
        DEPLOY_PATH,
        STATUS_PATH,
      ])
      // The deploy names the draft the apply stored, so an edit made since is never published.
      expect(request.mock.calls[1][1].body).toEqual({
        expectedDraftFingerprint: outcome().data.base.fingerprint,
      })
      expect(readFileSync(join(dir, 'workflow.ts'), 'utf8')).toBe(`${ENTRY}// stored\n`)
      expect(stdoutJson()).toMatchObject({
        applied: true,
        deployed: { version: 4, isDeployed: true },
        needsRedeployment: false,
      })
    })

    it('deploys no new version when a no-op apply leaves the live version matching the draft', async () => {
      setTerminal(false)
      const noop = outcome()
      noop.data.applied = false
      noop.data.diff.noop = true
      noop.data.needsRedeployment = false
      const status = (isDeployed: boolean) => ({
        data: {
          ...deployed.data,
          isDeployed,
          needsRedeployment: false,
          isPublicApi: false,
          webhooks: [],
          activeDeployment: isDeployed
            ? { deploymentVersionId: 'dv-7', version: 7, deployedAt: '2026-11-20T00:00:00Z' }
            : null,
        },
      })
      let live = true
      request.mockImplementation(async (path: string) =>
        path === STATUS_PATH ? status(live) : path === DEPLOY_PATH ? deployed : noop
      )

      await apply(WORKFLOW_ID, '--dir', dir, '--yes', '--deploy')

      expect(request.mock.calls.map((call) => call[0])).toEqual([APPLY_PATH, STATUS_PATH])
      expect(stdoutJson()).toMatchObject({
        deployed: { version: 7, isDeployed: true },
        needsRedeployment: false,
      })

      // A workflow never deployed is deployed, no-op or not.
      live = false
      request.mockClear()
      await apply(WORKFLOW_ID, '--dir', dir, '--yes', '--deploy')
      expect(request.mock.calls.map((call) => call[0])).toEqual([
        APPLY_PATH,
        STATUS_PATH,
        DEPLOY_PATH,
        STATUS_PATH,
      ])
    })

    it('without --deploy, names the deploy command when the deployed workflow now differs', async () => {
      setTerminal(false)
      request.mockResolvedValue(outcome())

      await apply(WORKFLOW_ID, '--dir', dir, '--yes')

      expect(request.mock.calls.map((call) => call[0])).toEqual([APPLY_PATH])
      expect(stdoutJson()).toMatchObject({
        needsRedeployment: true,
        next: {
          command: `sim workflows deploy ${WORKFLOW_ID} --expected-draft-fingerprint sf1:b`,
        },
      })
    })

    it('deploys nothing after a refused apply, and refuses beside --dry-run', async () => {
      setTerminal(false)
      request.mockResolvedValue(outcome({ diagnostics: [STALE] }))

      await apply(WORKFLOW_ID, '--dir', dir, '--yes', '--deploy')
      expect(request.mock.calls.map((call) => call[0])).toEqual([APPLY_PATH])

      request.mockClear()
      await expect(apply(WORKFLOW_ID, '--dir', dir, '--dry-run', '--deploy')).rejects.toThrow(
        /--dry-run saves nothing/
      )
      expect(request).not.toHaveBeenCalled()
    })

    it('says the apply was saved when the deploy after it fails', async () => {
      setTerminal(false)
      request.mockImplementation(async (path: string) => {
        if (path === DEPLOY_PATH) throw new SimApiError('Forbidden', 403, 'FORBIDDEN')
        return outcome()
      })

      const error = await apply(WORKFLOW_ID, '--dir', dir, '--yes', '--deploy').catch(
        (caught: unknown) => caught
      )

      expect(error).toMatchObject({ status: 403, code: 'FORBIDDEN' })
      expect((error as Error).message).toContain(`The apply was saved into ${dir}`)
      expect((error as Error).message).toContain(
        `sim workflows deploy ${WORKFLOW_ID} --expected-draft-fingerprint sf1:b`
      )
      expect(readFileSync(join(dir, 'workflow.ts'), 'utf8')).toBe(`${ENTRY}// stored\n`)
      // The saved write's result still prints, before the deploy's failure.
      expect(stdoutJson()).toMatchObject({ workflowId: WORKFLOW_ID, applied: true })
    })
  })

  it('exits 5 when a dry run finds the directory stale', async () => {
    setTerminal(false)
    request.mockResolvedValue(outcome({ dryRun: true, diagnostics: [STALE] }))

    await apply(WORKFLOW_ID, '--dir', dir, '--dry-run')

    expect(process.exitCode).toBe(5)
  })

  it('at a terminal, exits 5 without asking when the preview finds the directory stale', async () => {
    setTerminal(true)
    request.mockResolvedValue(outcome({ dryRun: true, diagnostics: [STALE] }))

    await apply(WORKFLOW_ID, '--dir', dir)

    expect(prompt.question).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(5)
  })
})

describe('sim workflows source apply in a workflow folder of a workspace directory', () => {
  const folder = () => join(dir, 'workflows/w')
  const rootJson = (path: string) => JSON.parse(readFileSync(join(dir, path), 'utf8'))
  const FOLDER_FILES = {
    'workflow.ts': ENTRY,
    '.sim/lock.json': JSON.stringify(LOCK),
    '.sim/base.json': JSON.stringify(BASE),
  }

  beforeEach(() => {
    rmSync(join(dir, 'workflow.ts'))
    rmSync(join(dir, '.sim'), { recursive: true })
    mkdirSync(join(folder(), '.sim'), { recursive: true })
    mkdirSync(join(dir, '.sim'))
    for (const [path, text] of Object.entries(FOLDER_FILES)) {
      writeFileSync(join(folder(), path), text)
    }
    writeFileSync(
      join(dir, '.sim/base.json'),
      JSON.stringify({
        version: 1,
        workspaceId: WORKSPACE_ID,
        resources: {
          'workflow:w': { id: WORKFLOW_ID, fingerprint: fingerprintOf({ source: 'sf1:a' }) },
          'table:leads': { id: 'tbl_1', fingerprint: 'rf1:t' },
        },
      })
    )
    const digests = Object.fromEntries(
      Object.entries(FOLDER_FILES).map(([path, text]) => [`workflows/w/${path}`, digest(text)])
    )
    writeFileSync(
      join(dir, '.sim/written.json'),
      JSON.stringify({ version: 1, files: { ...digests, 'tables/leads.ts': 'd' } })
    )
  })

  it('records the write in the workspace records, never a record of the folder of its own', async () => {
    setTerminal(false)
    request.mockResolvedValue(outcome())

    await apply('--dir', folder(), '--yes')

    expect(existsSync(join(folder(), '.sim/written.json'))).toBe(false)
    const files = rootJson('.sim/written.json').files
    for (const path of ['workflow.ts', '.sim/lock.json', '.sim/base.json']) {
      expect(files[`workflows/w/${path}`]).toBe(digest(readFileSync(join(folder(), path), 'utf8')))
    }
    expect(files['tables/leads.ts']).toBe('d')
    expect(rootJson('.sim/base.json').resources).toEqual({
      'workflow:w': { id: WORKFLOW_ID, fingerprint: fingerprintOf({ source: 'sf1:b' }) },
      'table:leads': { id: 'tbl_1', fingerprint: 'rf1:t' },
    })
  })
  it('refuses while a command holds the workspace directory, reading and writing nothing', async () => {
    setTerminal(false)
    request.mockResolvedValue(outcome())
    mkdirSync(join(dir, '.sim/command.lock'))
    writeFileSync(
      join(dir, '.sim/command.lock/owner.json'),
      JSON.stringify({ pid: process.pid, host: hostname() })
    )
    const records = ['.sim/written.json', '.sim/base.json'].map((path) =>
      readFileSync(join(dir, path), 'utf8')
    )

    const busy = await apply('--dir', folder(), '--yes').then(
      () => null,
      (error: unknown) => error
    )

    expect(busy).toBeInstanceOf(SimApiError)
    expect(busy).toMatchObject({ code: 'SOURCE_DIR_BUSY', exitCode: 10 })
    expect(request).not.toHaveBeenCalled()
    expect(
      ['.sim/written.json', '.sim/base.json'].map((path) => readFileSync(join(dir, path), 'utf8'))
    ).toEqual(records)
    expect(readFileSync(join(folder(), '.sim/base.json'), 'utf8')).toBe(
      FOLDER_FILES['.sim/base.json']
    )
  })

  it('holds the workspace directory while it writes, and lets go after', async () => {
    setTerminal(false)
    let lockedDuringWrite = false
    request.mockImplementation(async () => {
      lockedDuringWrite = existsSync(join(dir, '.sim/command.lock'))
      return outcome()
    })

    await apply('--dir', folder(), '--yes')

    expect(lockedDuringWrite).toBe(true)
    expect(existsSync(join(dir, '.sim/command.lock'))).toBe(false)
  })
})

describe('a standalone workflow directory', () => {
  it('refuses a second apply while the first holds the directory, sending nothing', async () => {
    setTerminal(false)
    let second: unknown = null
    request.mockResolvedValue(outcome())
    request.mockImplementationOnce(async () => {
      second = await apply('--dir', dir, '--yes').then(
        () => null,
        (error: unknown) => error
      )
      return outcome()
    })

    await apply('--dir', dir, '--yes')

    expect(second).toMatchObject({ code: 'SOURCE_DIR_BUSY', exitCode: 10 })
    expect(request).toHaveBeenCalledTimes(1)
    expect(existsSync(join(dir, '.sim/command.lock'))).toBe(false)
  })

  it('dry-runs and plans a directory no one may write, and refuses to apply it, sending nothing', async () => {
    setTerminal(false)
    request.mockResolvedValue(outcome({ dryRun: true }))
    for (const path of ['', '.sim']) chmodSync(join(dir, path), 0o555)
    try {
      await apply('--dir', dir, '--dry-run')
      await apply('--dir', dir)
      expect(dryRunFlags()).toEqual([true, true])

      const refused = await apply('--dir', dir, '--yes').then(
        () => null,
        (error: unknown) => error
      )
      expect(refused).toMatchObject({ code: 'SOURCE_DIR_UNWRITABLE' })
      expect(request).toHaveBeenCalledTimes(2)
    } finally {
      for (const path of ['', '.sim']) chmodSync(join(dir, path), 0o755)
    }
  })
})

describe('the code files an apply sends', () => {
  function writeFunctions(...names: string[]) {
    mkdirSync(join(dir, 'functions'), { recursive: true })
    for (const name of names) writeFileSync(join(dir, name), `// ${name}\n`)
  }

  /** An entry file that imports `codeFile` (as `alias` when given) and declares `body`. */
  function entryWith(body: string, alias?: string): string {
    const specifier = alias ? `codeFile as ${alias}` : 'codeFile'
    return `// @sim-sdk 1\nimport { ${specifier}, fn, workflow } from '@sim/workflow-sdk'\n\nexport default workflow('W', () => {})\n${body}`
  }

  async function applyEntry(entry: string): Promise<void> {
    writeFileSync(join(dir, 'workflow.ts'), entry)
    setTerminal(false)
    request.mockResolvedValue(outcome({ dryRun: true }))
    await apply(WORKFLOW_ID, '--dir', dir, '--dry-run')
  }

  it('sends a file named by a template literal without substitutions', async () => {
    writeFunctions('functions/a.js')

    await applyEntry(entryWith("const a = fn('A', { code: codeFile(`./functions/a.js`) })\n"))

    expect(sentCodeFiles()).toEqual(['functions/a.js'])
  })

  it('sends a file named by a call with spacing before the parenthesis', async () => {
    writeFunctions('functions/spaced.js')

    await applyEntry(entryWith("const a = fn('A', { code: codeFile ('./functions/spaced.js') })\n"))

    expect(sentCodeFiles()).toEqual(['functions/spaced.js'])
  })

  it('sends a file named through an aliased codeFile import', async () => {
    writeFunctions('functions/aliased.js')

    await applyEntry(
      entryWith("const a = fn('A', { code: fileCode('./functions/aliased.js') })\n", 'fileCode')
    )

    expect(sentCodeFiles()).toEqual(['functions/aliased.js'])
  })

  it('sends no file for a template literal with a substitution, which names no constant path', async () => {
    writeFunctions(`functions/\${name}.js`)

    await applyEntry(entryWith("const a = fn('A', { code: codeFile(`./functions/${name}.js`) })\n"))

    expect(sentCodeFiles()).toEqual([])
  })

  it('never sends a file a codeFile() inside a comment or a string names', async () => {
    writeFunctions(
      'functions/line.js',
      'functions/block.js',
      'functions/quoted.js',
      'functions/used.py'
    )

    await applyEntry(
      [
        entryWith(''),
        "// const old = fn('Old', { code: codeFile('./functions/line.js') })",
        "/* const old = fn('Old', {\n  code: codeFile('./functions/block.js') }) */",
        'const note = "codeFile(\'./functions/quoted.js\')"',
        "const used = fn('Used', { language: 'python', code: codeFile(\"./functions/used.py\") })",
        '',
      ].join('\n')
    )

    expect(sentCodeFiles()).toEqual(['functions/used.py'])
  })

  /** Applies `entry` with --yes, the server answering with `files` as what it stored. */
  async function applyStored(entry: string, files: Record<string, string>): Promise<void> {
    writeFileSync(join(dir, 'workflow.ts'), entry)
    setTerminal(false)
    const stored = outcome()
    request.mockResolvedValue({ data: { ...stored.data, files } })
    await apply(WORKFLOW_ID, '--dir', dir, '--yes')
  }

  it('applies a function file named with capitals and underscores, and writes the base and lock', async () => {
    writeFunctions('functions/My_Sink.js')
    const entry = entryWith(
      "const sink = fn('Sink', { code: codeFile('./functions/My_Sink.js') })\n"
    )

    await applyStored(entry, { 'workflow.ts': entry, 'functions/My_Sink.js': 'return 2\n' })

    expect(sentCodeFiles()).toEqual(['functions/My_Sink.js'])
    expect(readFileSync(join(dir, 'functions/My_Sink.js'), 'utf8')).toBe('return 2\n')
    expect(JSON.parse(readFileSync(join(dir, '.sim/base.json'), 'utf8')).fingerprint).toBe('sf1:b')
  })

  it('refuses before sending a code file outside functions/, which no workflow directory holds', async () => {
    mkdirSync(join(dir, 'lib'))
    writeFileSync(join(dir, 'lib/helper.js'), 'return 1\n')
    const entry = entryWith("const a = fn('A', { code: codeFile('./lib/helper.js') })\n")

    await expect(applyStored(entry, { 'workflow.ts': entry })).rejects.toMatchObject({
      code: 'E_CODE_FILE_PATH',
      message: expect.stringContaining('lib/helper.js is not a code file path'),
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('after a stored write, skips an answer path it never writes and still writes the base and lock', async () => {
    const entry = entryWith('')

    await applyStored(entry, { 'workflow.ts': entry, '.git/hooks/pre-commit.sh': 'exit 1\n' })

    expect(existsSync(join(dir, '.git/hooks/pre-commit.sh'))).toBe(false)
    expect(JSON.parse(readFileSync(join(dir, '.sim/base.json'), 'utf8')).fingerprint).toBe('sf1:b')
    expect(stderrLines().join('\n')).toContain(
      'the answer named .git/hooks/pre-commit.sh, which the CLI never writes'
    )
  })

  it('sends only .js, .py and .sh files, whatever the source or the lock names', async () => {
    writeFileSync(join(dir, '.env'), 'SECRET=1')
    writeFileSync(join(dir, 'notes.txt'), 'SECRET')
    writeFunctions('functions/run.sh')
    writeFileSync(
      join(dir, '.sim/lock.json'),
      JSON.stringify({
        ...LOCK,
        blocks: { a: { id: 'b-a', parent: null, ident: 'a', order: 0, codeFile: 'notes.txt' } },
      })
    )

    await applyEntry(
      entryWith(
        "const leak = fn('Leak', { code: codeFile('./.env') })\nconst run = fn('Run', { language: 'shell', code: codeFile('./functions/run.sh') })\n"
      )
    )

    expect(sentCodeFiles()).toEqual(['functions/run.sh'])
    expect(JSON.stringify(request.mock.calls[0][1].body)).not.toContain('SECRET')
  })
})

describe('sim workflows source create on a directory with no workflow.ts', () => {
  const CATALOG = JSON.parse(readFileSync(FIXTURE_CATALOG, 'utf8'))
  const MANIFEST = {
    data: {
      workspaceId: WORKSPACE_ID,
      tables: [],
      knowledgeBases: [],
      credentials: [],
      workflows: [],
      env: ['OPENAI_API_KEY'],
      truncated: false,
    },
  }

  async function create(...argv: string[]): Promise<void> {
    await program().parseAsync(['node', 'sim', 'workflows', 'source', 'create', ...argv])
  }

  it('writes a starter workflow.ts, the types, tsconfig and the guide, and creates nothing', async () => {
    setTerminal(false)
    vi.stubEnv('SIM_CONFIG_DIR', join(dir, 'config'))
    const empty = join(dir, 'new')
    request.mockImplementation(async (path: string) => {
      if (path.endsWith('/workflows/source/catalog')) return { data: CATALOG }
      if (path.endsWith('/workflows/source/resources')) return MANIFEST
      throw new Error(`unexpected request ${path}`)
    })

    await create('--dir', empty)

    const starter = readFileSync(join(empty, 'workflow.ts'), 'utf8')
    expect(existsSync(join(empty, '.sim/AGENTS.md'))).toBe(true)
    expect(existsSync(join(empty, '.sim/sdk/core.d.ts'))).toBe(true)
    expect(existsSync(join(empty, '.sim/sdk/workspace.d.ts'))).toBe(true)
    expect(existsSync(join(empty, 'tsconfig.json'))).toBe(true)
    expect(existsSync(join(empty, '.sim/lock.json'))).toBe(false)
    expect(request.mock.calls.map((call) => call[0])).not.toContain(
      `/api/v2/workspaces/${WORKSPACE_ID}/workflows/source`
    )
    const compiled = compileWorkflow({
      entry: { path: 'workflow.ts', text: starter },
      files: new Map(),
      catalog: CATALOG,
      sdkMajor: CATALOG.sdkMajor,
      knownKeys: new Set(),
    })
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(stderrLines()).toEqual([])
    const printed = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)?.join(' ') ?? '{}')
    expect(printed).toMatchObject({
      scaffolded: true,
      workspaceTypes: true,
      guide: '.sim/AGENTS.md',
      next: { command: expect.stringContaining('sim workflows source create --dir') },
    })
    expect(printed.files).toBeGreaterThan(0)
  })

  /** Answers the starter's catalog and manifest reads, and a create with a stored workflow. */
  function answerStarterAndCreate() {
    request.mockImplementation(async (path: string, init: { query?: { dryRun?: boolean } }) => {
      if (path.endsWith('/workflows/source/catalog')) return { data: CATALOG }
      if (path.endsWith('/workflows/source/resources')) return MANIFEST
      if (path.endsWith('/workflows/source')) return outcome({ dryRun: init.query?.dryRun })
      throw new Error(`unexpected request ${path}`)
    })
  }

  function createCalls(): string[] {
    return request.mock.calls
      .map((call) => call[0] as string)
      .filter((path) => path.endsWith('/workflows/source'))
  }

  it('plans a starter without reading or rewriting its workspace types', async () => {
    setTerminal(false)
    vi.stubEnv('SIM_CONFIG_DIR', join(dir, 'config'))
    const empty = join(dir, 'new')
    answerStarterAndCreate()
    await create('--dir', empty)
    request.mockClear()

    await create('--dir', empty)

    expect(createCalls()).toHaveLength(1)
    expect(request.mock.calls.map((call) => call[0])).not.toContainEqual(
      expect.stringContaining('/source/resources')
    )
  })

  it('records the workspace the starter was typed for and names it in the next step', async () => {
    setTerminal(false)
    vi.stubEnv('SIM_CONFIG_DIR', join(dir, 'config'))
    const empty = join(dir, 'new')
    answerStarterAndCreate()

    await create('--dir', empty)

    expect(JSON.parse(readFileSync(join(empty, '.sim/starter.json'), 'utf8'))).toEqual({
      workspaceId: WORKSPACE_ID,
    })
    expect(JSON.parse(vi.mocked(console.log).mock.calls.at(-1)?.join(' ') ?? '{}')).toMatchObject({
      next: {
        command: `sim workflows source create --dir ${empty} --workspace ${WORKSPACE_ID} --yes`,
      },
    })
  })

  it('creates a starter in the workspace it was typed for, whatever the profile default', async () => {
    setTerminal(false)
    vi.stubEnv('SIM_CONFIG_DIR', join(dir, 'config'))
    const starter = join(dir, 'new')
    answerStarterAndCreate()
    await create('--dir', starter)
    contextMockState.workspaceId = 'ws_other'
    contextMockState.workspaceSource = 'config'

    try {
      await create('--dir', starter, '--yes')
      expect(createCalls()).toEqual([`/api/v2/workspaces/${WORKSPACE_ID}/workflows/source`])
    } finally {
      contextMockState.workspaceId = WORKSPACE_ID
    }
  })

  it('creates a starter where --workspace names, and drops the starter record once created', async () => {
    setTerminal(false)
    vi.stubEnv('SIM_CONFIG_DIR', join(dir, 'config'))
    const starter = join(dir, 'new')
    answerStarterAndCreate()
    await create('--dir', starter)
    contextMockState.workspaceId = 'ws_other'
    contextMockState.workspaceSource = 'flag'

    try {
      await create('--dir', starter, '--yes')
      expect(createCalls()).toEqual(['/api/v2/workspaces/ws_other/workflows/source'])
      expect(existsSync(join(starter, '.sim/starter.json'))).toBe(false)
      expect(existsSync(join(starter, '.sim/base.json'))).toBe(true)
    } finally {
      contextMockState.workspaceId = WORKSPACE_ID
      contextMockState.workspaceSource = 'config'
    }
  })

  it.each(['--dry-run', '--yes'])('refuses %s instead of scaffolding', async (flag) => {
    setTerminal(false)
    vi.stubEnv('SIM_CONFIG_DIR', join(dir, 'config'))
    const empty = join(dir, 'missing')

    await expect(create('--dir', empty, flag)).rejects.toThrow(/missing has no workflow\.ts/)

    expect(existsSync(empty)).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })
})
