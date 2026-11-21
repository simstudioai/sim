/**
 * Printing grows linearly with the workflow (see `growth` for how a case is measured).
 */

import { expectLinearGrowth } from '@sim/testing/helpers/scaling'
import { describe, it } from 'vitest'
import { compareEdges } from '../canonicalize/edges'
import { compileWorkflow } from '../compile'
import { TEST_CATALOG } from '../compile/catalog.test-helpers'
import type { CanonicalBlock, CanonicalEdge, CanonicalWorkflow } from '../model'
import { type Doc, fill, group, indent, line, printDoc, softline } from './doc'
import { printWorkflow } from './printer'

function numberArray(count: number): Doc {
  const parts: Doc[] = []
  for (let i = 0; i < count; i += 1) {
    if (i > 0) parts.push([',', line])
    parts.push(String(i * 7))
  }
  return group(['[', indent([softline, fill(parts)]), softline, ']'])
}

/** One API block and one loop holding one API block, compiled once to copy from. */
function templateBlocks(): { api: CanonicalBlock; loop: CanonicalBlock; base: CanonicalWorkflow } {
  const text =
    "// @sim-sdk 1\nimport { api, loop, workflow } from '@sim/workflow-sdk'\n\n" +
    "export default workflow('Scale', {}, () => {\n  const a = api('A', { url: 'x' })\n" +
    "  const l = loop.for('L', { count: 1 }, (p) => {\n    const c = api('C', { url: 'x' })\n    p.to(c)\n  })\n})\n"
  const base = compileWorkflow({
    entry: { path: 'workflow.ts', text },
    files: new Map(),
    catalog: TEST_CATALOG,
    sdkMajor: 1,
  }).workflow
  const api = base?.blocks.a
  const loop = base?.blocks.l
  if (!base || !api || !loop) throw new Error('expected the template to compile')
  return { api, loop, base }
}

/**
 * `n` chained top-level blocks beside `n` sibling loops of one block each: every loop is a scope
 * whose wiring and declaration order must not rescan the top level.
 */
function siblingScopes(n: number): CanonicalWorkflow {
  const { api, loop, base } = templateBlocks()
  const blocks: Record<string, CanonicalBlock> = {}
  const edges: CanonicalEdge[] = []
  for (let i = 0; i < n; i += 1) {
    blocks[`a${i}`] = { ...api, key: `a${i}`, name: `A${i}` }
    blocks[`l${i}`] = { ...loop, key: `l${i}`, name: `L${i}` }
    blocks[`c${i}`] = { ...api, key: `c${i}`, name: `C${i}`, parent: `l${i}` }
    edges.push({ from: `l${i}`, port: { kind: 'subflowStart' }, to: `c${i}` })
    if (i > 0) edges.push({ from: `a${i - 1}`, port: { kind: 'out' }, to: `a${i}` })
  }
  return { ...base, blocks, edges: edges.sort(compareEdges) }
}

describe('print scaling', () => {
  it('fills a long number-only array in linear time', () => {
    expectLinearGrowth((n) => {
      const doc = numberArray(n)
      return () => printDoc(doc, 80)
    }, 5_000)
  })

  it('wires and orders many sibling scopes in linear time', () => {
    expectLinearGrowth((n) => {
      const workflow = siblingScopes(n)
      return () =>
        printWorkflow({ workflow, catalog: TEST_CATALOG, options: { functionCode: 'inline' } })
    }, 500)
  })
})
