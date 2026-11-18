/**
 * The printer goldens over the real catalog. Every golden case prints byte for byte to its golden
 * (`packages/workflow-code/src/print/__golden__/`), compiles back with zero errors to a workflow
 * that runs as the one it was printed from (its executable view), and reprints to the same bytes
 * from the compiled workflow and the hints the print returned. A print does not depend on record
 * order, and a one-param edit changes one line. Every golden then type-checks against the shipped
 * `core.d.ts` plus the SDK types generated from the same catalog, with the workspace's TypeScript 7
 * compiler.
 *
 * Refresh the goldens with
 * `bun run --cwd apps/sim test lib/workflows/code/goldens.test.ts -u`; never edit one by hand.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { compareStrings } from '@sim/utils/string'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/metadata-outputs')
vi.unmock('@/tools/registry')

import {
  type CanonicalWorkflow,
  type CompileResult,
  catalogBlock,
  compileWorkflow,
  executableInactiveParams,
  executableView,
  printWorkflow,
  type SourceHints,
} from '@sim/workflow-code'
import { editorDefaults } from '@sim/workflow-code/catalog/defaults'
import { cases, goldenCatalog as catalog } from '@/lib/workflows/code/golden-cases.test-helpers'
import { typeCheckAgainstSdk, writeSdkTypes } from '@/lib/workflows/code/sdk-typecheck.test-helpers'

const REPO_ROOT = path.resolve(process.cwd(), '../..')
const GOLDEN_DIR = path.join(REPO_ROOT, 'packages/workflow-code/src/print/__golden__')
const FILES_GOLDEN = 'function-files.txt'

const INLINE = { functionCode: 'inline' } as const

const goldenFiles = readdirSync(GOLDEN_DIR)
  .filter((name) => name.endsWith('.txt'))
  .sort(compareStrings)

function goldenPath(name: string): string {
  return path.join(GOLDEN_DIR, name)
}

function findCase(name: string) {
  const testCase = cases.find((candidate) => candidate.name === name)
  if (!testCase) throw new Error(`no golden case named ${name}`)
  return testCase
}

function print(workflow: CanonicalWorkflow, hints: SourceHints | undefined) {
  return printWorkflow({ workflow, catalog, hints, options: INLINE })
}

function compile(
  text: string,
  stored: CanonicalWorkflow,
  files: ReadonlyArray<[string, string]> = []
): CompileResult {
  return compileWorkflow({
    entry: { path: 'workflow.ts', text },
    files: new Map(files),
    catalog,
    sdkMajor: catalog.sdkMajor,
    stored,
  })
}

function commentTexts(workflow: CanonicalWorkflow): string[] {
  return Object.values(workflow.annotations.comments)
    .flatMap((comments) => comments?.map((comment) => comment.text) ?? [])
    .sort(compareStrings)
}

/**
 * The compiled workflow, after checking it compiled with zero errors and runs as `original`.
 * Annotations are not semantic, so only comment texts are compared: the printer hoists a comment
 * whose anchor it does not print and drops one whose block is gone.
 */
function expectCompilesBack(
  result: CompileResult,
  original: CanonicalWorkflow,
  printed: string
): CanonicalWorkflow {
  expect(
    result.diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => `${d.code} ${d.span.line}:${d.span.column} ${d.message}`)
  ).toEqual([])
  if (!result.workflow) throw new Error('expected a workflow')
  expect(executableView(result.workflow, catalog)).toEqual(executableView(original, catalog))
  expect(commentTexts(result.workflow)).toEqual(
    commentTexts(original).filter((text) => printed.includes(text))
  )
  return result.workflow
}

/** The same workflow with every record and list that has no semantic order reversed. */
function reorder(workflow: CanonicalWorkflow): CanonicalWorkflow {
  const copy = structuredClone(workflow)
  const reverseRecord = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).reverse())
  copy.blocks = reverseRecord(copy.blocks)
  for (const block of Object.values(copy.blocks)) {
    block.params = reverseRecord(block.params)
    block.modes = reverseRecord(block.modes)
  }
  copy.variables = reverseRecord(copy.variables)
  copy.edges = [...copy.edges].reverse()
  return copy
}

const EDITABLE_TYPES = new Set(['short-input', 'long-input', 'combobox'])

/**
 * Every single-line, token-free text param a user could retype, as (block, param) pairs. Inactive
 * params and values equal to the editor default are not printed, so editing one adds a line.
 */
function editableParams(workflow: CanonicalWorkflow): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (const block of Object.values(workflow.blocks)) {
    const declared = catalogBlock(catalog, block.type)
    const subBlocks = declared?.subBlocks ?? []
    const inactive = new Set(executableInactiveParams(block, catalog))
    const defaults = declared ? editorDefaults(declared) : new Map()
    for (const [id, param] of Object.entries(block.params)) {
      if (param.kind !== 'value' || typeof param.value !== 'string') continue
      if (inactive.has(id) || defaults.get(id) === param.value) continue
      if (!/^[\w .:/-]+$/.test(param.value)) continue
      const subBlock = subBlocks.find((candidate) => candidate.id === id)
      if (subBlock && (!EDITABLE_TYPES.has(subBlock.type) || subBlock.password)) continue
      pairs.push([block.key, id])
    }
  }
  return pairs
}

describe('printer goldens over the real catalog', () => {
  for (const testCase of cases) {
    it(`${testCase.name} prints its golden, compiles back and reprints identically`, async () => {
      const printed = print(testCase.workflow, testCase.hints)
      expect(printed.files).toHaveLength(1)
      const text = printed.files[0].text
      await expect(text).toMatchFileSnapshot(goldenPath(`${testCase.name}.txt`))

      const compiled = expectCompilesBack(compile(text, testCase.workflow), testCase.workflow, text)
      expect(print(compiled, printed.hints).files[0].text).toBe(text)
      expect(print(reorder(testCase.workflow), testCase.hints).files[0].text).toBe(text)

      for (const [blockKey, paramId] of editableParams(testCase.workflow)) {
        const edited = structuredClone(testCase.workflow)
        const param = edited.blocks[blockKey]?.params[paramId]
        if (param?.kind !== 'value' || typeof param.value !== 'string') continue
        const last = param.value.at(-1)
        param.value = `${param.value.slice(0, -1)}${last === 'q' ? 'z' : 'q'}`
        const before = text.split('\n')
        const after = print(edited, printed.hints).files[0].text.split('\n')
        expect(after.length, `${blockKey}.${paramId}`).toBe(before.length)
        const changed = after.filter((lineText, index) => lineText !== before[index])
        expect(changed, `${blockKey}.${paramId}`).toHaveLength(1)
      }
    })
  }

  it('reports the diagnostics each golden case produces', async () => {
    const report = Object.fromEntries(
      cases.map((testCase) => [
        testCase.name,
        print(testCase.workflow, testCase.hints).diagnostics.map(
          (d) => `${d.code} ${d.blockKey ?? '-'}: ${d.message}`
        ),
      ])
    )
    await expect(`${JSON.stringify(report, null, 2)}\n`).toMatchFileSnapshot(
      goldenPath('diagnostics.json')
    )
  })

  it('writes function code to language files and compiles them back', async () => {
    const testCase = findCase('function-languages')
    const printed = printWorkflow({
      workflow: testCase.workflow,
      catalog,
      options: { functionCode: 'files' },
    })
    const [entry, ...codeFiles] = printed.files
    expect(codeFiles.map((file) => file.path)).toEqual([
      'functions/js-code.js',
      'functions/py-code.py',
      'functions/sh-code.sh',
    ])
    expect(printed.diagnostics.filter((d) => d.code === 'W_CODE_FILE_INLINED')).toEqual([])
    await expect(entry.text).toMatchFileSnapshot(goldenPath(FILES_GOLDEN))
    const result = compile(
      entry.text,
      testCase.workflow,
      codeFiles.map((file) => [file.path, file.text])
    )
    expectCompilesBack(result, testCase.workflow, entry.text)
    expect(result.hints.blocks.jscode?.codeFile).toBe('functions/js-code.js')
  })

  it('prints function code inline with a warning when its file form would read back differently', () => {
    const testCase = findCase('function-languages')
    const workflow = structuredClone(testCase.workflow)
    const jscode = workflow.blocks.jscode
    if (!jscode) throw new Error('missing jscode')
    jscode.params.code = { kind: 'value', value: 'return <start.total>.length' }
    const result = printWorkflow({
      workflow,
      catalog,
      options: { functionCode: 'files' },
    })
    expect(result.files.map((file) => file.path)).toEqual([
      'workflow.ts',
      'functions/py-code.py',
      'functions/sh-code.sh',
    ])
    expect(result.files[0].text).toContain('return ${start.total}.length')
    const inlined = result.diagnostics.filter((d) => d.code === 'W_CODE_FILE_INLINED')
    expect(inlined.map((d) => d.blockKey)).toEqual(['jscode'])
  })

  it('has a case for every golden file', () => {
    const expected = [...cases.map((testCase) => `${testCase.name}.txt`), FILES_GOLDEN].sort(
      compareStrings
    )
    expect(goldenFiles).toEqual(expected)
  })

  it('type-checks every golden against core.d.ts and the types generated from the catalog', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'workflow-code-goldens-'))
    try {
      writeSdkTypes(outDir, catalog)
      mkdirSync(path.join(outDir, 'goldens'))
      for (const name of goldenFiles) {
        writeFileSync(
          path.join(outDir, 'goldens', name.replace(/\.txt$/, '.ts')),
          readFileSync(goldenPath(name), 'utf8')
        )
      }
      const diagnostics = typeCheckAgainstSdk(outDir, 'goldens', [
        path.join(outDir, 'goldens/*.ts'),
      ])
      expect(diagnostics).toBe('')
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 120_000)
})
