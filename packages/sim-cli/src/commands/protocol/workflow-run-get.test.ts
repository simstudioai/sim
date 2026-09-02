/**
 * @vitest-environment node
 */
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimApiError } from '../../http/client'
import { buildGeneratedCommands } from '../../runtime/build'
import { attachWorkflowRunGet } from './workflow-run-get'

const { output, request } = vi.hoisted(() => ({
  output: { format: 'json' },
  request: vi.fn(),
}))

vi.mock('../../context', () => ({
  clientFrom: () => ({
    client: { request, requireWorkspace: () => 'ws_local' },
    profile: {
      workspaceId: 'ws_local',
      output: output.format,
      name: 'default',
      apiKey: 'k',
      endpoint: 'https://sim.example',
    },
  }),
}))

const WORKFLOW_ID = '00000000-0000-4000-8000-00000000000a'
const SUMMARIZE_ID = '11111111-1111-4111-8111-111111111111'
const SAVE_ID = '22222222-2222-4222-8222-222222222222'
const RUN_ID = 'run_1'
const RUN_PATH = `/api/v2/workflows/${WORKFLOW_ID}/runs/${RUN_ID}`
const STATE_PATH = `/api/v2/workflows/${WORKFLOW_ID}/state`

/** The draft graph as `GET …/state` answers it, with the two names a caller might type. */
const STATE = {
  data: {
    blocks: {
      [SUMMARIZE_ID]: { id: SUMMARIZE_ID, name: 'Summarize Result', type: 'agent' },
      [SAVE_ID]: { id: SAVE_ID, name: 'save', type: 'function' },
    },
  },
}

function program(): Command {
  const root = new Command('sim')
  for (const command of buildGeneratedCommands()) root.addCommand(command)
  const workflows = root.commands.find((command) => command.name() === 'workflows')
  const runs = workflows?.commands.find((command) => command.name() === 'runs')
  if (!runs) throw new Error('workflows runs group missing')
  attachWorkflowRunGet(runs)
  const override = (command: Command) => {
    command.exitOverride()
    command.commands.forEach(override)
  }
  override(root)
  return root
}

async function get(...argv: string[]): Promise<void> {
  await program().parseAsync([
    'node',
    'sim',
    'workflows',
    'runs',
    'get',
    RUN_ID,
    '--workflow',
    WORKFLOW_ID,
    ...argv,
  ])
}

/** Answers the graph read with the graph and every other read with `run`. */
function answer(run: unknown): void {
  request.mockImplementation(async (path: string) => (path === STATE_PATH ? STATE : run))
}

function stdout(): () => string {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
  return () => spy.mock.calls.map((call) => call.map(String).join(' ')).join('\n')
}

beforeEach(() => {
  output.format = 'json'
  request.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sim workflows runs get --select-output', () => {
  it('sends an id-headed selection through the generated path untouched', async () => {
    answer({ data: { runId: RUN_ID, status: 'completed', blockOutputs: {} } })
    stdout()

    await get('--select-output', `${SUMMARIZE_ID}.result`)

    // One read: the graph is never fetched for a selection the run resource
    // already answers.
    expect(request).toHaveBeenCalledTimes(1)
    const [path, options] = request.mock.calls[0]
    expect(path).toBe(RUN_PATH)
    expect(options.query).toEqual({ selectedOutputs: `${SUMMARIZE_ID}.result` })
  })

  it('reads nothing extra without a selection', async () => {
    answer({ data: { runId: RUN_ID, status: 'completed' } })
    stdout()

    await get('--include-output')

    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toBe(RUN_PATH)
    expect(request.mock.calls[0][1].query).toEqual({ includeOutput: true })
  })

  it('resolves block names against the workflow, the way workflows run does', async () => {
    answer({
      data: {
        runId: RUN_ID,
        status: 'completed',
        blockOutputs: { [`${SUMMARIZE_ID}.text`]: 'A summary', [SAVE_ID]: { ok: true } },
      },
    })
    const read = stdout()

    // `summarizeresult` is `Summarize Result` under the executor's rule: case,
    // spaces and dots do not count.
    await get('--select-output', 'summarizeresult.text', 'Save')

    expect(request.mock.calls.map(([path]) => path)).toEqual([STATE_PATH, RUN_PATH])
    expect(request.mock.calls[1][1].query).toEqual({
      selectedOutputs: `${SUMMARIZE_ID}.text,${SAVE_ID}`,
    })
    // Keyed by what was typed, as `workflows run` keys its own `blockOutputs`.
    expect(JSON.parse(read()).blockOutputs).toEqual({
      'summarizeresult.text': 'A summary',
      Save: { ok: true },
    })
  })

  it('keeps an id-headed selector as is beside a name', async () => {
    answer({ data: { runId: RUN_ID, status: 'completed', blockOutputs: {} } })
    stdout()

    await get('--select-output', `${SAVE_ID}.rows`, 'Summarize Result.text')

    expect(request.mock.calls[1][1].query).toEqual({
      selectedOutputs: `${SAVE_ID}.rows,${SUMMARIZE_ID}.text`,
    })
  })

  it('carries the other flags through with a resolved name', async () => {
    answer({ data: { runId: RUN_ID, status: 'completed', blockOutputs: {} } })
    stdout()

    await get('--include-output', '--select-output', 'save.result')

    expect(request.mock.calls[1][1].query).toEqual({
      includeOutput: true,
      selectedOutputs: `${SAVE_ID}.result`,
    })
  })

  it('refuses a name no block carries, says names are accepted, and lists them', async () => {
    answer({ data: { runId: RUN_ID, status: 'completed' } })

    const failure = await get('--select-output', 'summarise.text', SAVE_ID).catch(
      (error: unknown) => error
    )

    expect(failure).toBeInstanceOf(SimApiError)
    expect((failure as SimApiError).message).toBe(
      `--select-output did not resolve to any block on this run: summarise.text. Pass a block id or its name — "blockId", "blockId.path", "blockName" or "blockName.path"; names match ignoring case, spaces and dots. Blocks on workflow ${WORKFLOW_ID}: Summarize Result, save.`
    )
    // Only the graph was read; the run was never asked for a selection it
    // cannot answer.
    expect(request.mock.calls.map(([path]) => path)).toEqual([STATE_PATH])
  })
})
