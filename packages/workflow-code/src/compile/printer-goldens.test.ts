import { compareStrings } from '@sim/utils/string'
import { describe, expect, it } from 'vitest'
import { portKey } from '../anchors'
import type { CompileResult } from '../api'
import type { CanonicalWorkflow } from '../model'
import { printWorkflow } from '../print'
import { cases } from '../print/__fixtures__/cases'
import { catalog } from '../print/__fixtures__/catalog'
import { compileWorkflow } from './index'

/**
 * P3/P4 against the printer (Wave 2C): every printer case prints to source that compiles with zero
 * errors (s3 D12) and back to the canonical workflow it was printed from. The printer's golden
 * test pins these prints byte for byte. Annotations are not semantic, so only the comment texts
 * are compared: the printer hoists a comment whose anchor it does not print and drops one whose
 * block is gone.
 */

function compile(text: string, files: Record<string, string> = {}): CompileResult {
  return compileWorkflow({
    entry: { path: 'workflow.ts', text },
    files: new Map(Object.entries(files)),
    catalog,
    sdkMajor: catalog.sdkMajor,
  })
}

function semantic(workflow: CanonicalWorkflow) {
  return {
    meta: workflow.meta,
    variables: workflow.variables,
    blocks: workflow.blocks,
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
  expect(semantic(result.workflow)).toEqual(semantic(original))
  expect(commentTexts(result.workflow)).toEqual(
    commentTexts(original).filter((text) => golden.includes(text))
  )
}

describe('printer cases compile back to their canonical workflow', () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const printed = printWorkflow({
        workflow: testCase.workflow,
        catalog,
        hints: testCase.hints,
        options: { functionCode: 'inline' },
      })
      const golden = printed.files[0].text
      expectRoundTrip(compile(golden), testCase.workflow, golden)
    })
  }

  it('function-languages in files mode, with code files written by the code-file codec', () => {
    const testCase = cases.find((candidate) => candidate.name === 'function-languages')
    if (!testCase) throw new Error('missing case')
    const printed = printWorkflow({
      workflow: testCase.workflow,
      catalog,
      options: { functionCode: 'files', codeDir: 'functions' },
    })
    const [entry, ...codeFiles] = printed.files
    expect(codeFiles.map((file) => file.path)).toEqual([
      'functions/js-code.js',
      'functions/py-code.py',
      'functions/sh-code.sh',
    ])
    const files = Object.fromEntries(codeFiles.map((file) => [file.path, file.text]))
    const result = compile(entry.text, files)
    expectRoundTrip(result, testCase.workflow, entry.text)
    expect(result.hints.blocks.jscode?.codeFile).toBe('functions/js-code.js')
  })
})
