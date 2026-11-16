import { describe, expect, it } from 'vitest'
import { type CodeFileCodec, type CodeFileLanguage, codeFileCodec } from '../code-files'
import { cases } from './__fixtures__/cases'
import { catalog } from './__fixtures__/catalog'
import { createPrintWorkflow, printWorkflow } from './printer'

const GOLDEN_DIR = './__golden__'

/** A codec whose round trip adds a byte: the printer must fall back to inline code. */
const lossyCodec: CodeFileCodec = {
  toFile: (code) => code,
  fromFile: (text) => `${text}\n`,
}

describe('printWorkflow golden files', () => {
  for (const testCase of cases) {
    it(`prints ${testCase.name}`, async () => {
      const result = printWorkflow({
        workflow: testCase.workflow,
        catalog,
        hints: testCase.hints,
        options: { functionCode: 'inline' },
      })
      expect(result.files).toHaveLength(1)
      await expect(result.files[0].text).toMatchFileSnapshot(`${GOLDEN_DIR}/${testCase.name}.txt`)
    })
  }

  it('reports the diagnostics each golden case produces', async () => {
    const report = Object.fromEntries(
      cases.map((testCase) => {
        const { diagnostics } = printWorkflow({
          workflow: testCase.workflow,
          catalog,
          hints: testCase.hints,
          options: { functionCode: 'inline' },
        })
        return [
          testCase.name,
          diagnostics.map((d) => `${d.code} ${d.blockKey ?? '-'}: ${d.message}`),
        ]
      })
    )
    await expect(`${JSON.stringify(report, null, 2)}\n`).toMatchFileSnapshot(
      `${GOLDEN_DIR}/diagnostics.json`
    )
  })

  it('writes function code to language files through the code-files codec by default', async () => {
    const testCase = cases.find((c) => c.name === 'function-languages')
    if (!testCase) throw new Error('missing case')
    const result = printWorkflow({
      workflow: testCase.workflow,
      catalog,
      options: { functionCode: 'files', codeDir: 'functions' },
    })
    expect(result.files.map((file) => file.path)).toEqual([
      'workflow.ts',
      'functions/js-code.js',
      'functions/py-code.py',
      'functions/sh-code.sh',
    ])
    const functions: Array<[string, CodeFileLanguage]> = [
      ['jscode', 'javascript'],
      ['pycode', 'python'],
      ['shcode', 'shell'],
    ]
    expect(result.files.slice(1).map((file) => file.text)).toEqual(
      functions.map(([key, language]) => {
        const param = testCase.workflow.blocks[key]?.params.code
        if (param?.kind !== 'value' || typeof param.value !== 'string') return null
        return codeFileCodec.toFile(param.value, language)
      })
    )
    expect(result.files[1]?.text).toContain('$ref.start.total + $env.TAX_RATE')
    expect(result.hints.blocks.jscode?.codeFile).toBe('functions/js-code.js')
    expect(result.diagnostics.filter((d) => d.code === 'W_CODE_FILE_INLINED')).toEqual([])
    await expect(result.files[0].text).toMatchFileSnapshot(`${GOLDEN_DIR}/function-files.txt`)
  })

  it('falls back to inline code with a warning when the codec round trip is lossy or absent', () => {
    const testCase = cases.find((c) => c.name === 'function-languages')
    if (!testCase) throw new Error('missing case')
    const inline = printWorkflow({
      workflow: testCase.workflow,
      catalog,
      options: { functionCode: 'inline' },
    })
    for (const print of [createPrintWorkflow(lossyCodec), createPrintWorkflow()]) {
      const result = print({
        workflow: testCase.workflow,
        catalog,
        options: { functionCode: 'files', codeDir: 'functions' },
      })
      expect(result.files).toHaveLength(1)
      expect(result.files[0].text).toBe(inline.files[0].text)
      const inlined = result.diagnostics.filter((d) => d.code === 'W_CODE_FILE_INLINED')
      expect(inlined.map((d) => d.blockKey)).toEqual(['jscode', 'pycode', 'shcode'])
    }
  })
})
