/**
 * Printer contract: its output compiles with zero errors and keeps every reference a reference,
 * so a rename follows it.
 */
import { describe, expect, it } from 'vitest'
import { compileWorkflow } from '../compile'
import { TEST_CATALOG } from '../compile/catalog.test-helpers'
import type { CanonicalWorkflow } from '../model'
import { printWorkflow } from './printer'

const IMPORTS = "import { agent, api, customTool, js, workflow } from '@sim/workflow-sdk'"

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

/** Prints inline; no emitted file holds a raw carriage return, which checkouts rewrite. */
function printed(workflow: CanonicalWorkflow) {
  const output = printWorkflow({
    workflow,
    catalog: TEST_CATALOG,
    options: { functionCode: 'inline' },
  })
  for (const file of output.files) expect(file.text).not.toContain('\r')
  return output
}

describe('printWorkflow round trip', () => {
  it('keeps a variable token named like an Object.prototype member as text', () => {
    const output = printed(compiled("  const a = api('A', { url: 'x<variable.constructor>' })"))
    const [entry] = output.files
    expect(entry?.text).not.toContain('vars.constructor')
    const again = compile(entry?.text ?? '')
    expect(again.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })

  it('prints a literal credential id as raw() and compiles it back into the advanced member', () => {
    const text =
      "// @sim-sdk 1\nimport { mail, raw, workflow } from '@sim/workflow-sdk'\n\n" +
      "export default workflow('Test', {}, () => {\n  const m = mail.send('M', { credential: raw('cred-123'), to: 'a@b.co' })\n})\n"
    const first = compile(text)
    expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const workflow = first.workflow
    if (!workflow) throw new Error('expected a workflow')
    expect(workflow.blocks.m?.params.manualCredential).toEqual({ kind: 'value', value: 'cred-123' })
    const entry = printed(workflow).files[0]?.text ?? ''
    expect(entry).toContain("credential: raw('cred-123')")
    expect(compile(entry).workflow?.blocks.m?.params).toEqual(workflow.blocks.m?.params)
  })

  it('escapes carriage returns in text values and compiles them back unchanged', () => {
    const workflow = compiled("  const a = api('A', { url: 'x\\r\\ny\\rz' })")
    expect(JSON.stringify(workflow.blocks.a?.params.url)).toContain('\\r')
    const output = printed(workflow)
    const again = compile(output.files[0]?.text ?? '')
    expect(again.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(again.workflow?.blocks.a?.params.url).toEqual(workflow.blocks.a?.params.url)
  })

  it('declares a block referenced only from a custom tool policy before its referrer', () => {
    const output = printed(
      compiled(
        [
          "  const a = agent('A', { model: 'm', tools: [customTool('lookup', { usageControlExpression: js`${zed.content} === 1` })] })",
          "  const zed = agent('Zed', { model: 'm' })",
        ].join('\n')
      )
    )
    expect(output.diagnostics.map((d) => d.code)).not.toContain('W_FORWARD_REF_LITERALIZED')
    expect(output.files[0]?.text).toContain('${zed.content}')
  })
})

describe('a container param holding a detected credential', () => {
  it('prints as stored() under meta.extra and compiles back to the stored value', () => {
    const token = ['Bearer', 'abcdef0123456789abcdef'].join(' ')
    const text =
      "// @sim-sdk 1\nimport { api, loop, workflow } from '@sim/workflow-sdk'\n\n" +
      `export default workflow('Test', {}, () => {\n  const l = loop.for('L', { count: 2 }, (p) => {\n    const a = api('A', { url: 'x' })\n    p.to(a)\n  }, { extra: { legacyAuth: '${token}' } })\n})\n`
    const first = compile(text)
    const workflow = first.workflow
    if (!workflow) throw new Error('expected a workflow')
    expect(workflow.blocks.l?.params.legacyAuth).toEqual({ kind: 'value', value: token })
    const entry = printed(workflow).files[0]?.text ?? ''
    expect(entry).toContain('legacyAuth: stored()')
    expect(entry).not.toContain(token)
    const again = compileWorkflow({
      entry: { path: 'workflow.ts', text: entry },
      files: new Map(),
      catalog: TEST_CATALOG,
      sdkMajor: 1,
      stored: workflow,
    })
    expect(again.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(again.workflow?.blocks.l?.params).toEqual(workflow.blocks.l?.params)
  })
  it('names a block like a builder namespace only when the file builds with that namespace', () => {
    const alone = printed(compiled("  const mail = api('Mail', { url: 'x' })")).files[0]?.text ?? ''
    expect(alone).toContain("const mail = api('Mail'")
    expect(compile(alone).diagnostics.filter((d) => d.severity === 'error')).toEqual([])

    const text =
      "// @sim-sdk 1\nimport { api, mail, workflow } from '@sim/workflow-sdk'\n\n" +
      "export default workflow('Test', {}, () => {\n  const mail2 = api('Mail', { url: 'x' })\n  const m = mail.send('M', { to: 'a@b.co' })\n})\n"
    const both = compile(text).workflow
    if (!both) throw new Error('expected a workflow')
    const entry = printed(both).files[0]?.text ?? ''
    expect(entry).toContain("const mail2 = api('Mail'")
    expect(compile(entry).diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })
})
