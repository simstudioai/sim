import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cacheCatalogText } from '../../test/catalog-cache'
import { contextMockFns, mockedProfile } from '../../test/context-mock'
import { attachWorkflowSourceFind } from './workflow-source-find'

vi.mock('../../context', async () => (await import('../../test/context-mock')).contextMock)

/** A real catalog projected from registry blocks, shared with the SDK's own type checks. */
const FIXTURE_TEXT = readFileSync(
  join(__dirname, '../../../../workflow-sdk/test/fixtures/catalog.json'),
  'utf8'
)

const WORKFLOW_TS = `// @sim-sdk 1
import { api, codeFile, condition, fn, js, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('W', {}, () => {
  const start = trigger.start('Start', { inputFormat: { url: { type: 'string' } } })
  const fetchPolicy = api('Fetch Policy', { url: start.url, method: 'GET' })
  start.to(fetchPolicy)
  const score = fn('Score', { code: codeFile('./functions/score.js') })
  fetchPolicy.to(score)
  const fallback = fn('Fallback', { code: js\`return 0\` })
  fetchPolicy.onError(fallback)
  const audit = fn('Audit', { language: 'python', code: codeFile('./functions/audit.py') })
  fetchPolicy.to(audit)
  const gate = condition('Gate', { if: js\`\${fetchPolicy.status} === 200\`, else: true })
  score.to(gate)
})
`

let dir: string

async function find(...argv: string[]): Promise<void> {
  const source = new Command('source')
  attachWorkflowSourceFind(source)
  source.commands.forEach((command) => command.exitOverride())
  await source.parseAsync(['node', 'source', 'find', ...argv, '--dir', dir])
}

function stdoutJson(): { blocks: Array<Record<string, unknown>> } {
  const calls = vi.mocked(console.log).mock.calls
  expect(calls).toHaveLength(1)
  return JSON.parse(calls[0].join(' '))
}

/** The 1-based line of `text` in the workflow file. */
function lineOf(text: string): number {
  return WORKFLOW_TS.split('\n').findIndex((line) => line.includes(text)) + 1
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-source-find-'))
  mkdirSync(join(dir, '.sim'))
  mkdirSync(join(dir, 'functions'))
  writeFileSync(join(dir, 'workflow.ts'), WORKFLOW_TS)
  writeFileSync(
    join(dir, 'functions/score.js'),
    "const s = 1\nreturn $ref.fetchpolicy.data ?? $ref.fetchpolicy.status\nconst tag = '<fetchpolicy.status>'\n"
  )
  writeFileSync(join(dir, 'functions/audit.py'), 'import json\nprint(<fetchpolicy.data>)\n')
  vi.stubEnv('SIM_CONFIG_DIR', join(dir, 'config'))
  cacheCatalogText(join(dir, 'config'), null, FIXTURE_TEXT)
  writeFileSync(
    join(dir, '.sim/base.json'),
    JSON.stringify({
      version: 1,
      workflowId: 'wf',
      workspaceId: 'ws_find',
      fingerprint: 'sf1:a',
      catalogHash: JSON.parse(FIXTURE_TEXT).hash,
    })
  )
  contextMockFns.mockProfileFrom.mockReturnValue({ ...mockedProfile(), output: 'json' })
  contextMockFns.mockRequest.mockReset()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('sim workflows source find', () => {
  it("locates a block's declaration, edges and readers by line without a request", async () => {
    await find('Fetch Policy')
    const [block] = stdoutJson().blocks
    expect(block).toMatchObject({
      key: 'fetchpolicy',
      ident: 'fetchPolicy',
      file: 'workflow.ts',
      line: lineOf("api('Fetch Policy'"),
      incoming: [{ block: 'Start', line: lineOf('start.to(fetchPolicy)') }],
      outgoing: [
        { block: 'Score', port: 'out', line: lineOf('fetchPolicy.to(score)') },
        { block: 'Fallback', port: 'error', line: lineOf('fetchPolicy.onError(fallback)') },
        {
          block: 'Audit',
          port: 'out',
          line: lineOf('fetchPolicy.to(audit)'),
          statement: 'fetchPolicy.to(audit)',
        },
      ],
      readers: [
        { block: 'Audit', file: 'functions/audit.py', line: 2 },
        { block: 'Score', file: 'functions/score.js', line: 2 },
        { block: 'Score', file: 'functions/score.js', line: 3 },
        { block: 'Gate', file: 'workflow.ts', line: lineOf("condition('Gate'") },
      ],
    })
    expect(contextMockFns.mockRequest).not.toHaveBeenCalled()
  })

  it('names the line that reads the block, not the first line of a field or block that spans several', async () => {
    const multiline = WORKFLOW_TS.replace(
      "const gate = condition('Gate', { if: js`${fetchPolicy.status} === 200`, else: true })",
      [
        "const gate = condition('Gate', {",
        '    if: js`true &&',
        '      ${fetchPolicy.status} === 200`,',
        '    else: true,',
        '  })',
      ].join('\n')
    )
    expect(multiline).not.toBe(WORKFLOW_TS)
    writeFileSync(join(dir, 'workflow.ts'), multiline)

    await find('Fetch Policy')

    const readsAt =
      multiline.split('\n').findIndex((line) => line.includes('${fetchPolicy.status} === 200')) + 1
    expect(stdoutJson().blocks[0].readers).toContainEqual(
      expect.objectContaining({ block: 'Gate', file: 'workflow.ts', line: readsAt })
    )
  })

  it('takes a key or identifier, and prints every block a part of a name matches', async () => {
    await find('fetchPolicy')
    expect(stdoutJson().blocks.map((block) => block.name)).toEqual(['Fetch Policy'])
    vi.mocked(console.log).mockClear()
    await find('o')
    expect(stdoutJson().blocks.map((block) => block.name)).toEqual(['Fetch Policy', 'Score'])
  })

  it('refuses a name no block has, suggesting the closest', async () => {
    await expect(find('Fetch Polcy')).rejects.toMatchObject({
      code: 'BLOCK_UNKNOWN',
      message: expect.stringContaining('Did you mean Fetch Policy?'),
    })
  })

  it('says the source does not compile instead of only that no block matches', async () => {
    writeFileSync(
      join(dir, 'workflow.ts'),
      WORKFLOW_TS.replace("api('Fetch Policy', {", "api('Fetch Policy', {{")
    )
    await expect(find('Fetch Policy')).rejects.toMatchObject({
      code: 'BLOCK_UNKNOWN',
      message: expect.stringContaining('does not compile'),
    })
  })

  it('reads a wiring statement the printer wrapped as one statement', async () => {
    const wrapped = WORKFLOW_TS.replace('fetchPolicy.to(audit)', 'fetchPolicy.to(\n    audit,\n  )')
    writeFileSync(join(dir, 'workflow.ts'), wrapped)
    await find('Audit')
    const [block] = stdoutJson().blocks
    expect(block.incoming).toMatchObject([
      { block: 'Fetch Policy', statement: 'fetchPolicy.to(audit)' },
    ])
  })

  it('refuses an empty name rather than matching every block', async () => {
    await expect(find(' ')).rejects.toMatchObject({ code: 'BLOCK_UNKNOWN' })
    await expect(find('.')).rejects.toMatchObject({ code: 'BLOCK_UNKNOWN' })
  })
})
