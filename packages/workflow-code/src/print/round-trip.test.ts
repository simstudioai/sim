/**
 * Printer contract: its output compiles with zero errors and keeps every reference a reference,
 * so a rename follows it.
 */
import { describe, expect, it } from 'vitest'
import { compileWorkflow } from '../compile'
import { TEST_CATALOG } from '../compile/test-catalog'
import type { CanonicalWorkflow } from '../model'
import { printWorkflow } from './printer'

const IMPORTS = "import { api, workflow } from '@sim/workflow-sdk'"

function compile(text: string) {
  return compileWorkflow({
    entry: { path: 'workflow.ts', text },
    files: new Map(),
    catalog: TEST_CATALOG,
    sdkMajor: 1,
  })
}

function compiled(body: string): CanonicalWorkflow {
  const text = `// @sim-sdk 1\n${IMPORTS}\n\nexport default workflow('Test', {}, () => {\n${body}\n})\n`
  const result = compile(text)
  expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  if (!result.workflow) throw new Error('expected a workflow')
  return result.workflow
}

function printed(workflow: CanonicalWorkflow) {
  return printWorkflow({ workflow, catalog: TEST_CATALOG, options: { functionCode: 'inline' } })
}

describe('printWorkflow round trip', () => {
  it('keeps a variable token named like an Object.prototype member as text', () => {
    const output = printed(compiled("  const a = api('A', { url: 'x<variable.constructor>' })"))
    const [entry] = output.files
    expect(entry?.text).not.toContain('vars.constructor')
    const again = compile(entry?.text ?? '')
    expect(again.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })
})
