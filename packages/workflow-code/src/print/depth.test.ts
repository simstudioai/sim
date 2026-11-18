/**
 * The printer's `entryDepth` is an upper bound on the printed entry's Babel syntax-tree depth: a
 * get skips parsing its print whenever the bound is under `SOURCE_LIMITS.maxDepth`, so a bound
 * below the real depth would hand out source that apply refuses.
 */
import { parse } from '@babel/parser'
import type { Node } from '@babel/types'
import { describe, expect, it } from 'vitest'
import { childNodes } from '../babel'
import { compileWorkflow } from '../compile'
import { TEST_CATALOG } from '../compile/catalog.test-helpers'
import { sourceDepthOverflow } from '../compile/parse'
import { SOURCE_LIMITS } from '../limits'
import type { CanonicalWorkflow, Json } from '../model'
import { printWorkflow } from './printer'

const IMPORTS =
  "import { agent, api, condition, customTool, fn, js, loop, mcp, parallel, raw, t, trigger, workflow } from '@sim/workflow-sdk'"

function compiled(body: string): CanonicalWorkflow {
  const text = `// @sim-sdk 1\n${IMPORTS}\n\nexport default workflow('Depth', { variables: { n: { type: 'number', value: 1 } } }, ({ vars }) => {\n${body}\n})\n`
  const result = compileWorkflow({
    entry: { path: 'workflow.ts', text },
    files: new Map(),
    catalog: TEST_CATALOG,
    sdkMajor: 1,
  })
  expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  if (!result.workflow) throw new Error('expected a workflow')
  return result.workflow
}

/** The depth compile measures: the root `File` is 1. */
function treeDepth(text: string): number {
  const root: Node = parse(text, { sourceType: 'module', plugins: ['typescript'] })
  let deepest = 0
  const stack: Array<{ node: Node; depth: number }> = [{ node: root, depth: 1 }]
  for (let entry = stack.pop(); entry; entry = stack.pop()) {
    deepest = Math.max(deepest, entry.depth)
    for (const child of childNodes(entry.node)) stack.push({ node: child, depth: entry.depth + 1 })
  }
  return deepest
}

function nestedObject(levels: number): string {
  return `${'{ a: '.repeat(levels)}1${' }'.repeat(levels)}`
}

const BODIES: Record<string, string> = {
  'an empty workflow': '',
  'refs, templates and a negative number': [
    "  const start = trigger.start('Start', { inputFormat: { q: 'string' } })",
    "  const call = api('Call', { url: t`https://x/${start.input.q}/${vars.n}`, body: { deep: { list: [1, -2, { x: start.input.q }] } } })",
    '  start.to(call)',
  ].join('\n'),
  'agent tools and conditions': [
    "  const start = trigger.start('Start', {})",
    "  const a = agent('A', { model: 'gpt-4o', tools: [customTool('lookup'), mcp('docs').tool('search', { args: { q: 'x' } })] })",
    "  const c = condition('C', { yes: js`${a.content} === 'y'`, else: true })",
    '  start.to(a)',
    '  a.to(c)',
    "  const f = fn('F', { code: js`return 1` })",
    '  c.yes.to(f)',
  ].join('\n'),
  'nested containers': [
    "  const start = trigger.start('Start', {})",
    "  const outer = loop.forEach('Outer', { collection: [1, 2] }, (o) => {",
    "    const inner = parallel.count('Inner', { count: 2 }, (p) => {",
    "      const deepest = loop.for('Deepest', { count: 3 }, (d) => {",
    "        const leaf = api('Leaf', { url: t`${o.currentItem}`, body: { a: { b: { c: [o.index] } } } })",
    '        d.to(leaf)',
    '      })',
    '      p.to(deepest)',
    '    })',
    '    o.to(inner)',
    '  })',
    '  start.to(outer)',
  ].join('\n'),
  'a deeply nested value': `  api('Deep', { url: 'https://x', body: ${nestedObject(60)} })`,
}

describe('printWorkflow entryDepth', () => {
  it.each(Object.entries(BODIES))('bounds the depth of %s from above', (_, body) => {
    const printed = printWorkflow({
      workflow: compiled(body),
      catalog: TEST_CATALOG,
      options: { functionCode: 'inline' },
    })
    expect(printed.entryDepth).toBeGreaterThanOrEqual(treeDepth(printed.files[0].text))
  })

  it('lets the depth guard refuse a print nested past the cap within the bracket cap', () => {
    const workflow = compiled("  api('Deep', { url: 'https://x' })")
    let value: Json = 1
    for (let level = 0; level < 120; level++) value = { a: value }
    const deep = workflow.blocks.deep
    if (!deep) throw new Error('expected the Deep block')
    deep.params.body = { kind: 'value', value }
    const printed = printWorkflow({
      workflow,
      catalog: TEST_CATALOG,
      options: { functionCode: 'inline' },
    })
    const files = { 'workflow.ts': printed.files[0].text }
    expect(treeDepth(files['workflow.ts'])).toBeGreaterThan(SOURCE_LIMITS.maxDepth)
    expect(printed.entryDepth).toBeGreaterThan(SOURCE_LIMITS.maxDepth)
    expect(sourceDepthOverflow(files, printed.entryDepth)).toBe('workflow.ts')
  })
})
