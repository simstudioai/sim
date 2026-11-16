import { compareStrings } from '@sim/utils/string'
import { describe, expect, it } from 'vitest'
import { portKey } from '../anchors'
import type { CompileResult } from '../api'
import { toCodeFile } from '../code-files'
import type { CanonicalWorkflow } from '../model'
import { cases } from './__printer__/cases'
import { catalog } from './__printer__/catalog'
import { PRINTER_GOLDENS } from './__printer__/goldens'
import { compileWorkflow } from './index'

/**
 * P3/P4 against the printer (Wave 2C): every golden print compiles with zero errors (s3 D12) and
 * back to the canonical workflow it was printed from. Annotations are not semantic, so only the
 * comment texts are compared: the printer hoists a comment whose anchor it does not print and
 * drops one whose block is gone.
 *
 * The printer's hand-built cases predate two CWM invariants, so the originals are completed
 * before comparing, never the compiled side: `errorPort` is effective (`errorEnabled || has an
 * error edge`, model.ts), and `modes` holds every canonical pair of the block's surface, with an
 * absent entry meaning the default `basic` the printer assumes.
 */

function compile(text: string, files: Record<string, string> = {}): CompileResult {
  return compileWorkflow({
    entry: { path: 'workflow.ts', text },
    files: new Map(Object.entries(files)),
    catalog,
    sdkMajor: catalog.sdkMajor,
  })
}

function completeInvariants(workflow: CanonicalWorkflow): CanonicalWorkflow['blocks'] {
  const blocks: CanonicalWorkflow['blocks'] = {}
  for (const [key, block] of Object.entries(workflow.blocks)) {
    const hasErrorEdge = workflow.edges.some(
      (edge) => edge.from === key && edge.port.kind === 'error'
    )
    const modes = { ...block.modes }
    const surface = block.triggerMode ? 'trigger' : 'action'
    for (const sub of catalog.blocks[block.type]?.subBlocks ?? []) {
      if (block.subflow || sub.canonicalParamId === undefined) continue
      if (sub.surface !== undefined && sub.surface !== surface) continue
      modes[sub.canonicalParamId] ??= 'basic'
    }
    blocks[key] = { ...block, errorPort: block.errorPort || hasErrorEdge, modes }
  }
  return blocks
}

function semantic(workflow: CanonicalWorkflow, complete = false) {
  return {
    meta: workflow.meta,
    variables: workflow.variables,
    blocks: complete ? completeInvariants(workflow) : workflow.blocks,
    edges: [...workflow.edges].sort(
      (a, b) =>
        compareStrings(a.from, b.from) ||
        compareStrings(portKey(a.port), portKey(b.port)) ||
        compareStrings(a.to, b.to)
    ),
  }
}

function commentTexts(workflow: CanonicalWorkflow): string[] {
  return Object.values(workflow.annotations.comments)
    .flatMap((comments) => comments?.map((comment) => comment.text) ?? [])
    .sort(compareStrings)
}

function expectRoundTrip(result: CompileResult, original: CanonicalWorkflow, golden: string) {
  expect(
    result.diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => `${d.code} ${d.span.line}:${d.span.column} ${d.message}`)
  ).toEqual([])
  if (!result.workflow) throw new Error('expected a workflow')
  expect(semantic(result.workflow)).toEqual(semantic(original, true))
  expect(commentTexts(result.workflow)).toEqual(
    commentTexts(original).filter((text) => golden.includes(text))
  )
}

describe('printer goldens compile back to their canonical workflow', () => {
  it('has a golden for every printer case', () => {
    expect(cases.map((testCase) => testCase.name).sort(compareStrings)).toEqual(
      Object.keys(PRINTER_GOLDENS)
        .filter((name) => name !== 'function-files')
        .sort(compareStrings)
    )
  })

  for (const testCase of cases) {
    it(testCase.name, () => {
      const golden = PRINTER_GOLDENS[testCase.name]
      if (golden === undefined) throw new Error(`missing golden ${testCase.name}`)
      expectRoundTrip(compile(golden), testCase.workflow, golden)
    })
  }

  it('function-files, with code files written by the code-file codec', () => {
    const testCase = cases.find((candidate) => candidate.name === 'function-languages')
    const golden = PRINTER_GOLDENS['function-files']
    if (!testCase || golden === undefined) throw new Error('missing case')
    const files: Record<string, string> = {}
    const layout = [
      ['jscode', 'functions/js-code.js', 'javascript'],
      ['pycode', 'functions/py-code.py', 'python'],
      ['shcode', 'functions/sh-code.sh', 'shell'],
    ] as const
    for (const [key, path, language] of layout) {
      const param = testCase.workflow.blocks[key]?.params.code
      if (param?.kind !== 'value' || typeof param.value !== 'string') throw new Error('no code')
      files[path] = toCodeFile(param.value, language)
    }
    const result = compile(golden, files)
    expectRoundTrip(result, testCase.workflow, golden)
    expect(result.hints.blocks.jscode?.codeFile).toBe('functions/js-code.js')
  })
})
