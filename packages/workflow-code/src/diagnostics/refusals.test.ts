import { describe, expect, it } from 'vitest'
import { TEST_CATALOG } from '../compile/catalog.test-helpers'
import { compileWorkflow } from '../compile/index'
import { FINDING_LIMITS } from './bound'
import { MAX_ERRORS } from './codes'
import { type EditedBlocks, refuseEditedFindings } from './refusals'

const IMPORTS =
  "import { api, block, codeFile, fn, loop, t, trigger, workflow } from '@sim/workflow-sdk'"

function compile(
  body: string[],
  files: Record<string, string> = {},
  options: Partial<Parameters<typeof compileWorkflow>[0]> = {}
) {
  const text = `// @sim-sdk 1\n${IMPORTS}\n\nexport default workflow('Test', () => {\n${body.map((line) => `  ${line}`).join('\n')}\n})\n`
  return compileWorkflow({
    entry: { path: 'workflow.ts', text },
    files: new Map(Object.entries(files)),
    catalog: TEST_CATALOG,
    sdkMajor: 1,
    ...options,
  })
}

/** An edit that changed exactly `keys`, code files included. */
function edited(...keys: string[]): EditedBlocks {
  return { changed: (key) => keys.includes(key), codeEdited: (key) => keys.includes(key) }
}

function errors(findings: ReadonlyArray<{ code: string; severity: string; blockKey?: string }>) {
  return findings
    .filter((finding) => finding.severity === 'error')
    .map((finding) => `${finding.code} ${finding.blockKey}`)
}

const START = "const start = trigger.start('Start')"

describe('refuseEditedFindings', () => {
  it('refuses an edited block’s warning that the per-code cap left out of the listing', () => {
    const flood = Array.from(
      { length: FINDING_LIMITS.warningsPerCode },
      (_, i) => `q${i} = $ref.start.q${i}`
    )
    const compiled = compile(
      [
        START,
        "const a = fn('A', { language: 'python', code: codeFile('./functions/a.py') })",
        "const b = fn('B', { language: 'python', code: codeFile('./functions/b.py') })",
        'start.to(a)',
        'a.to(b)',
      ],
      { 'functions/a.py': flood.join('\n'), 'functions/b.py': 'y = $ref.a.result' }
    )
    expect(
      compiled.diagnostics.filter((d) => d.code === 'W_CODE_FILE_REF_SYNTAX' && d.blockKey === 'b')
    ).toEqual([])

    expect(errors(refuseEditedFindings(compiled, edited('b')))).toEqual([
      'E_APPLY_CODE_FILE_REF_SYNTAX b',
    ])
    expect(errors(refuseEditedFindings(compiled, edited()))).toEqual([])
  })

  it('keeps x.error on a block with no error edge a warning, as the run reads nothing there', () => {
    const compiled = compile([
      START,
      "const call = api('Call', { url: 'https://x' })",
      "const next = api('Next', { url: t`${call.error}` })",
      'start.to(call)',
      'call.to(next)',
    ])

    expect(errors(refuseEditedFindings(compiled, edited('next')))).toEqual([])
  })

  it('refuses a path no output has in workflow.ts on a changed block only', () => {
    const compiled = compile([
      START,
      "const call = api('Call', { url: 'https://x' })",
      "const next = api('Next', { url: t`${call.dat}` })",
      'start.to(call)',
      'call.to(next)',
    ])

    expect(errors(refuseEditedFindings(compiled, edited('next')))).toEqual([
      'E_APPLY_UNRESOLVED_REF next',
    ])
    expect(errors(refuseEditedFindings(compiled, edited('call')))).toEqual([])
  })

  it('refuses a literal tag naming no block on a changed block, as the server lint does', () => {
    const compiled = compile([
      START,
      "const call = api('Call', { url: 'https://x/<gone.id>' })",
      "const cased = api('Cased', { url: 'https://x/<Call.data>' })",
      "const bare = api('Bare', { url: 'https://x/<b>' })",
      'start.to(call)',
    ])

    expect(errors(refuseEditedFindings(compiled, edited('call', 'cased', 'bare')))).toEqual([
      'E_APPLY_UNRESOLVED_REF call',
    ])
    expect(errors(refuseEditedFindings(compiled, edited('cased', 'bare')))).toEqual([])
  })

  it('keeps a literal tag naming a block the source renamed, which the apply rewrites', () => {
    const compiled = compile(
      [START, "const call = api('Call', { url: 'https://x/<former.id>' })"],
      {},
      { renamedKeys: new Map([['former', 'call']]) }
    )

    expect(errors(refuseEditedFindings(compiled, edited('call')))).toEqual([])
  })

  it('refuses a new block of a type the catalog does not hold, as the placement gate does', () => {
    for (const type of ['slak', 'toString', '__proto__']) {
      const compiled = compile([START, `const a = block('${type}', 'A', { text: 'hi' })`])
      expect(errors(refuseEditedFindings(compiled, edited('a')))).toEqual([
        'E_APPLY_INVALID_BLOCK_TYPE a',
      ])
    }
  })

  it('keeps a block of an uncatalogued type the lock already binds', () => {
    const compiled = compile(
      [START, "const a = block('retired_kind', 'A', { text: 'hi' })"],
      {},
      {
        storedUnread: {
          version: 1,
          blocks: { a: { id: 'b-a', parent: null, ident: 'a', order: 0 } },
          variables: {},
        },
      }
    )
    expect(compiled.diagnostics.map((d) => d.code)).toEqual([])
    expect(errors(refuseEditedFindings(compiled, edited('a')))).toEqual([])
  })

  it('refuses a new block of a type the catalog keeps only for blocks already using it', () => {
    const catalog = {
      ...TEST_CATALOG,
      blocks: {
        ...TEST_CATALOG.blocks,
        api: { ...TEST_CATALOG.blocks.api, addable: false as const },
      },
    }
    const body = [
      START,
      "const a = api('A', { url: 'x' })",
      "const b = block('api', 'B', { url: 'x' })",
    ]

    const added = compile(body, {}, { catalog })
    expect(errors(refuseEditedFindings(added, edited('a', 'b')))).toEqual([
      'E_APPLY_TYPE_NOT_ADDABLE a',
      'E_APPLY_TYPE_NOT_ADDABLE b',
    ])

    const bound = compile(
      body,
      {},
      {
        catalog,
        storedUnread: {
          version: 1,
          blocks: {
            a: { id: 'b-a', parent: null, ident: 'a', order: 0 },
            b: { id: 'b-b', parent: null, ident: 'b', order: 1 },
          },
          variables: {},
        },
      }
    )
    expect(errors(refuseEditedFindings(bound, edited('a', 'b')))).toEqual([])
  })

  it('refuses an iteration field a shared code file reads for a block outside the loop', () => {
    const compiled = compile(
      [
        START,
        "const lp = loop.forEach('Each', { collection: '[1]' }, (body) => {",
        "  const inner = fn('Inner', { code: codeFile('./functions/index.js') })",
        '  body.to(inner)',
        '})',
        "const after = fn('After', { code: codeFile('./functions/index.js') })",
        'start.to(lp)',
        'lp.to(after)',
      ],
      { 'functions/index.js': 'return $ref.each.index' }
    )

    expect(errors(refuseEditedFindings(compiled, edited('after')))).toEqual([
      'E_APPLY_REF_OUT_OF_SCOPE after',
    ])
    expect(errors(refuseEditedFindings(compiled, edited('inner')))).toEqual([])
  })

  it('refuses a loop condition the run cannot evaluate on an edited loop, and only there', () => {
    const compiled = compile([
      START,
      "const w = loop.while('W', { condition: '<loop.index> < (3' }, (body) => {",
      "  const inner = fn('Inner', { code: 'return 1' })",
      '  body.to(inner)',
      '})',
      'start.to(w)',
    ])

    expect(errors(refuseEditedFindings(compiled, edited('w')))).toEqual([
      'E_APPLY_LOOP_CONDITION_SYNTAX w',
    ])
    expect(errors(refuseEditedFindings(compiled, edited('inner')))).toEqual([])
  })

  it('refuses a path no output has in an edited code file, and only there', () => {
    const compiled = compile(
      [
        START,
        "const call = api('Call', { url: 'https://x' })",
        "const next = fn('Next', { code: codeFile('./functions/next.js') })",
        'start.to(call)',
        'call.to(next)',
      ],
      { 'functions/next.js': 'return $ref.call.dat' }
    )
    const changedOnly: EditedBlocks = { changed: (key) => key === 'next', codeEdited: () => false }

    expect(errors(refuseEditedFindings(compiled, edited('next')))).toEqual([
      'E_APPLY_UNRESOLVED_REF next',
    ])
    expect(errors(refuseEditedFindings(compiled, changedOnly))).toEqual([])
  })

  it('refuses an iteration field read outside its container in an unedited code file of a changed block', () => {
    const compiled = compile(
      [
        START,
        "const lp = loop.forEach('Each', { collection: '[1]' }, (body) => {",
        "  const inner = fn('Inner', { code: 'return 1' })",
        '  body.to(inner)',
        '})',
        "const after = fn('After', { code: codeFile('./functions/after.js') })",
        'start.to(lp)',
        'lp.to(after)',
      ],
      { 'functions/after.js': 'return $ref.each.index' }
    )
    const changedOnly: EditedBlocks = {
      changed: (key) => key === 'after',
      codeEdited: () => false,
    }

    expect(errors(refuseEditedFindings(compiled, changedOnly))).toEqual([
      'E_APPLY_REF_OUT_OF_SCOPE after',
    ])
    expect(errors(refuseEditedFindings(compiled, edited()))).toEqual([])
  })

  it('lists refused withheld findings only up to the error cap, then one summary error', () => {
    const count = MAX_ERRORS + 30
    const keys = Array.from({ length: count }, (_, i) => `f${i}`)
    const compiled = compile(
      [
        START,
        ...keys.map(
          (key) =>
            `const ${key} = fn('${key}', { language: 'python', code: codeFile('./functions/${key}.py') })`
        ),
        ...keys.map((key) => `start.to(${key})`),
      ],
      Object.fromEntries(keys.map((key) => [`functions/${key}.py`, 'x = $ref.start.input']))
    )
    const refused = errors(refuseEditedFindings(compiled, edited(...keys)))

    expect(refused).toHaveLength(MAX_ERRORS + 1)
    expect(refused.at(-1)).toMatch(/^E_TOO_MANY_ERRORS /)
    expect(
      refused.slice(0, -1).every((line) => line.startsWith('E_APPLY_CODE_FILE_REF_SYNTAX'))
    ).toBe(true)
  })
})
