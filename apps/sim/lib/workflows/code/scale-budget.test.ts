/**
 * Workflow source at the block cap. A synthetic workflow of `MAX_WORKFLOW_GRAPH_BLOCKS` blocks
 * (chained agents with long prompts, API calls, function blocks with code files, conditions, loops
 * with members, comments; a 1.1 MB entry file) makes the trip a get and an apply make: canonicalize
 * the stored state, print it with code files, compile the print, materialize the result. It must
 * fit the shared source limits with every default and finish inside `ROUND_TRIP_BUDGET_MS`; one
 * block more must be refused.
 *
 * The budget catches a quadratic step, not a slow machine. On an M-series laptop the trip takes
 * about 0.4 s and grows linearly with the workflow. Restoring the printer's old line-end trim,
 * which rescanned the whole output at every line break, makes it 7.4 s. The budget leaves about 7x
 * headroom for slower CI runners and still fails that regression by a factor of two or more. It
 * counts this thread's CPU time where the runtime reports it, so a loaded machine that stretches
 * wall time does not fail it.
 */
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/metadata-outputs')
vi.unmock('@/tools/registry')

import {
  type CanonicalWorkflow,
  canonicalize,
  compileWorkflow,
  materialize,
  printWorkflow,
} from '@sim/workflow-code'
import { SOURCE_LIMITS, sourceLimitExcesses } from '@sim/workflow-code/limits'
import {
  MAX_WORKFLOW_GRAPH_BLOCKS,
  MAX_WORKFLOW_GRAPH_EDGES,
} from '@/lib/api/contracts/v2/workflows'
import { registryCatalog as catalog } from '@/lib/workflows/code/catalog/registry-catalog.test-helpers'
import { createMaterializeHooks } from '@/lib/workflows/code/materialize-hooks'

const ROUND_TRIP_BUDGET_MS = 3_000
const LOOP_MEMBERS = 8
/** A system prompt of realistic length, so the entry file is near 1 MB like a large real one. */
const PROMPT = Array.from(
  { length: 24 },
  (_, line) => `Rule ${line + 1}: answer from the ticket history, cite the source, and stay brief.`
).join(' ')

/** CPU milliseconds this thread has used, or wall milliseconds on a runtime without the counter. */
function threadMs(): number {
  if (typeof process.threadCpuUsage !== 'function') return performance.now()
  const { user, system } = process.threadCpuUsage()
  return (user + system) / 1000
}

const hooks = createMaterializeHooks()
const meta = { name: 'Scale', description: null }

interface Step {
  lines: string[]
  /** The block the next step's edge comes from: a condition continues from its `yes` branch. */
  wireFrom: string
  ident: string
  blocks: number
}

/** One top-level block, cycling agent, API call, function, condition, each reading `previous`. */
function step(index: number, previous: string): Step {
  const ident = `step${index}`
  const comment = index % 10 === 0 ? [`  // Step ${index}`] : []
  const declare = (lines: string[], wireFrom = ident): Step => ({
    lines: [...comment, ...lines],
    wireFrom,
    ident,
    blocks: 1,
  })
  switch (index % 4) {
    case 0:
      return declare([
        `  const ${ident} = agent('Step ${index}', {`,
        '    messages: [',
        `      { role: 'system', content: '${PROMPT}' },`,
        `      { role: 'user', content: t\`Summarize \${${previous}.content} for run ${index}\` },`,
        '    ],',
        "    model: 'claude-sonnet-5-5',",
        '  })',
      ])
    case 1:
      return declare([
        `  const ${ident} = api('Step ${index}', {`,
        `    url: t\`https://api.example.com/items/\${${previous}.data}?page=${index}\`,`,
        "    method: 'GET',",
        '  })',
      ])
    case 2:
      return declare([
        `  const ${ident} = fn('Step ${index}', {`,
        `    code: js\`const value = \${${previous}.data}`,
        `return { value, index: ${index} }\`,`,
        '  })',
      ])
    default:
      return declare(
        [
          `  const ${ident} = condition('Step ${index}', {`,
          `    yes: js\`\${${previous}.result} !== null\`,`,
          '    else: true,',
          '  })',
        ],
        `${ident}.yes`
      )
  }
}

/** A loop of `LOOP_MEMBERS` chained API calls over the trigger's items. */
function loopStep(index: number): Step {
  const ident = `loop${index}`
  const members = Array.from({ length: LOOP_MEMBERS }, (_, member) => `member${index}x${member}`)
  return {
    ident,
    wireFrom: ident,
    blocks: LOOP_MEMBERS + 1,
    lines: [
      `  const ${ident} = loop.forEach('Loop ${index}', { collection: start.items }, (p) => {`,
      ...members.map(
        (member, position) =>
          `    const ${member} = api('Member ${index} ${position}', { url: t\`https://api.example.com/\${p.currentItem}/${position}\`, method: 'GET' })`
      ),
      `    p.to(${members[0]})`,
      ...members.slice(1).map((member, position) => `    ${members[position]}.to(${member})`),
      '  })',
    ],
  }
}

/** Source text declaring exactly `blocks` blocks, the trigger included. */
function syntheticSource(blocks: number): string {
  const declarations: string[] = []
  const wiring: string[] = []
  let previous = 'start'
  let wireFrom = 'start'
  let count = 1
  for (let index = 0; count < blocks; index++) {
    const next =
      index % 50 === 49 && blocks - count > LOOP_MEMBERS ? loopStep(index) : step(index, previous)
    declarations.push(...next.lines)
    wiring.push(`  ${wireFrom}.to(${next.ident})`)
    count += next.blocks
    previous = next.blocks === 1 ? next.ident : 'start'
    wireFrom = next.wireFrom
  }
  return [
    '// @sim-sdk 1',
    "import { agent, api, condition, fn, js, loop, t, trigger, workflow } from '@sim/workflow-sdk'",
    '',
    "export default workflow('Scale', {}, () => {",
    "  const start = trigger.start('Start', { inputFormat: { items: 'array' } })",
    ...declarations,
    '',
    ...wiring,
    '})',
    '',
  ].join('\n')
}

function compileText(files: Array<{ path: string; text: string }>, stored?: CanonicalWorkflow) {
  const [entry, ...codeFiles] = files
  return compileWorkflow({
    entry,
    files: new Map(codeFiles.map((file) => [file.path, file.text])),
    catalog,
    sdkMajor: catalog.sdkMajor,
    ...(stored && { knownKeys: new Set(Object.keys(stored.blocks)), stored }),
  })
}

function errorsOf(result: ReturnType<typeof compileText>) {
  return result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
}

/** The stored state of a synthetic workflow, as an apply of its source would leave it. */
function storedState(blocks: number) {
  const compiled = compileText([{ path: 'workflow.ts', text: syntheticSource(blocks) }])
  expect(errorsOf(compiled)).toEqual([])
  if (!compiled.workflow) throw new Error('synthetic source did not compile')
  return materialize(compiled.workflow, null, { catalog, hooks, lockFreshness: 'none' }).state
}

describe('workflow source at the block cap', () => {
  it(`round-trips ${MAX_WORKFLOW_GRAPH_BLOCKS} blocks within ${ROUND_TRIP_BUDGET_MS} ms`, () => {
    const state = storedState(MAX_WORKFLOW_GRAPH_BLOCKS)
    expect(Object.keys(state.blocks)).toHaveLength(MAX_WORKFLOW_GRAPH_BLOCKS)

    const started = threadMs()
    const stored = canonicalize(state, { catalog, meta })
    const printed = printWorkflow({
      workflow: stored.workflow,
      catalog,
      options: { functionCode: 'files' },
    })
    const compiled = compileText(printed.files, stored.workflow)
    const workflow = compiled.workflow
    if (workflow)
      materialize(workflow, null, { catalog, hooks, prev: state, lockFreshness: 'none' })
    const elapsed = threadMs() - started

    expect(errorsOf(compiled)).toEqual([])
    expect(Object.keys(workflow?.blocks ?? {})).toHaveLength(MAX_WORKFLOW_GRAPH_BLOCKS)
    const files = Object.fromEntries(printed.files.map((file) => [file.path, file.text]))
    expect(
      sourceLimitExcesses(files, {
        blocks: MAX_WORKFLOW_GRAPH_BLOCKS,
        edges: workflow?.edges.length ?? 0,
        variables: 0,
      })
    ).toEqual([])
    expect(elapsed).toBeLessThan(ROUND_TRIP_BUDGET_MS)
  })

  it('refuses one block over the cap in compile and in the get check', () => {
    const source = syntheticSource(MAX_WORKFLOW_GRAPH_BLOCKS + 1)
    const compiled = compileText([{ path: 'workflow.ts', text: source }])
    expect(errorsOf(compiled).map((diagnostic) => diagnostic.code)).toEqual(['E_LIMIT_EXCEEDED'])
    expect(
      sourceLimitExcesses({}, { blocks: MAX_WORKFLOW_GRAPH_BLOCKS + 1, edges: 0, variables: 0 })
    ).toEqual([
      { limit: 'maxBlocks', actual: MAX_WORKFLOW_GRAPH_BLOCKS + 1, max: SOURCE_LIMITS.maxBlocks },
    ])
  })

  it('refuses a stored graph over the edge cap in the get check, matching compile', () => {
    expect(
      sourceLimitExcesses({}, { blocks: 2, edges: MAX_WORKFLOW_GRAPH_EDGES + 1, variables: 0 })
    ).toEqual([
      { limit: 'maxEdges', actual: MAX_WORKFLOW_GRAPH_EDGES + 1, max: SOURCE_LIMITS.maxEdges },
    ])
  })
})
