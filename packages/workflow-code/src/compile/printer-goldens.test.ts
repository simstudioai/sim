import { compareStrings } from '@sim/utils/string'
import { describe, expect, it } from 'vitest'
import type { CompileResult, PrintOptions } from '../api'
import { executableView } from '../equivalence/executable'
import type { CanonicalWorkflow } from '../model'
import { printWorkflow } from '../print'
import { cases } from '../print/__fixtures__/cases'
import { realCatalog as catalog } from '../print/__fixtures__/real-catalog'
import { compileWorkflow } from './index'

/**
 * P0/P3/P4 against the printer, over the real catalog (`real-catalog.json`): every printer case
 * prints to source that compiles with zero errors (s3 D12), runs as the canonical workflow it was
 * printed from (its executable view: wave 4 source holds what executes, and apply restores the
 * preserved UI state), and a lean print reprints to the same bytes. A verbose print compiles and
 * runs the same too; it is a debugging view, so its reprint is not pinned. The
 * printer's golden test pins the prints byte for byte. Annotations are not semantic, so only the
 * comment texts are compared: the printer hoists a comment whose anchor it does not print and
 * drops one whose block is gone.
 */

function compile(text: string, files: Record<string, string> = {}): CompileResult {
  return compileWorkflow({
    entry: { path: 'workflow.ts', text },
    files: new Map(Object.entries(files)),
    catalog,
    sdkMajor: catalog.sdkMajor,
  })
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
  expect(executableView(result.workflow, catalog)).toEqual(executableView(original, catalog))
  expect(commentTexts(result.workflow)).toEqual(
    commentTexts(original).filter((text) => golden.includes(text))
  )
}

describe('printer cases compile back to their canonical workflow', () => {
  const modes: Array<[string, PrintOptions]> = [
    ['lean', { functionCode: 'inline' }],
    ['verbose', { functionCode: 'inline', verbose: true }],
  ]
  for (const testCase of cases) {
    for (const [mode, options] of modes) {
      it(`${testCase.name} (${mode})`, () => {
        const print = (workflow: CanonicalWorkflow) =>
          printWorkflow({ workflow, catalog, hints: testCase.hints, options }).files[0].text
        const golden = print(testCase.workflow)
        const result = compile(golden)
        expectRoundTrip(result, testCase.workflow, golden)
        if (mode === 'lean' && result.workflow) expect(print(result.workflow)).toBe(golden)
      })
    }
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
