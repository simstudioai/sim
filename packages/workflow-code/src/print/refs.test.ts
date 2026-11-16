import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { compileWorkflow } from '../compile'
import type { CanonicalWorkflow, Value } from '../model'
import { cases } from './__fixtures__/cases'
import { realCatalog as catalog } from './__fixtures__/real-catalog'
import { printWorkflow } from './index'

const SEGMENT_CHARS = [...'aZ_$07- \'"+<>é{`']

const segment = fc.oneof(
  fc
    .array(fc.constantFrom(...SEGMENT_CHARS), { minLength: 1, maxLength: 4 })
    .map((chars) => `.${chars.join('')}`),
  fc.oneof(fc.nat({ max: 12 }), fc.constantFrom('01', '1e3', '')).map((index) => `[${index}]`)
)

function withMessage(content: string): CanonicalWorkflow {
  const base = cases.find((candidate) => candidate.name === 'templates-and-paths')
  if (!base) throw new Error('missing case')
  const { workflow } = base
  const writer = workflow.blocks.writer
  const messages = { kind: 'value' as const, value: [{ role: 'user', content }] }
  const next = { ...writer, params: { ...writer.params, messages } }
  return { ...workflow, blocks: { ...workflow.blocks, writer: next } }
}

function compiledMessages(workflow: CanonicalWorkflow): Value | undefined {
  const printed = printWorkflow({ workflow, catalog, options: { functionCode: 'inline' } })
  const result = compileWorkflow({
    entry: { path: 'workflow.ts', text: printed.files[0].text },
    files: new Map(),
    catalog,
    sdkMajor: catalog.sdkMajor,
  })
  expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
  const param = result.workflow?.blocks.writer.params.messages
  return param?.kind === 'value' ? param.value : undefined
}

describe('reference paths', () => {
  it('compile back to the stored path the printer read, or stay literal text', () => {
    fc.assert(
      fc.property(fc.array(segment, { maxLength: 4 }), (segments) => {
        const content = `x <start${segments.join('')}> y`
        expect(compiledMessages(withMessage(content))).toEqual([{ role: 'user', content }])
      }),
      { numRuns: 200 }
    )
  })
})
