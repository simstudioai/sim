/**
 * Print determinism over every golden case. Until the compiler lands this stands in for P3
 * (`print(compile(print(x))) === print(x)`): the same model prints the same bytes whatever the
 * order of its records, the hints a print returns reproduce that print, and a one-param edit
 * changes exactly one line.
 */

import { describe, expect, it } from 'vitest'
import type { LockHints } from '../api'
import type { CanonicalWorkflow } from '../model'
import { cases } from './__fixtures__/cases'
import { catalog } from './__fixtures__/catalog'
import { printWorkflow } from './printer'

/** A deep copy of plain data: every CWM value is JSON (`model.ts`). */
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T
  }
  return value
}

function print(workflow: CanonicalWorkflow, hints: LockHints | undefined) {
  return printWorkflow({ workflow, catalog, hints, options: { functionCode: 'inline' } })
}

/** The same workflow with every record and list that has no semantic order reversed. */
function reorder(workflow: CanonicalWorkflow): CanonicalWorkflow {
  const copy = clone(workflow)
  const reverseRecord = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).reverse())
  copy.blocks = reverseRecord(copy.blocks)
  for (const block of Object.values(copy.blocks)) {
    block.params = reverseRecord(block.params)
    block.modes = reverseRecord(block.modes)
  }
  copy.variables = reverseRecord(copy.variables)
  copy.edges = [...copy.edges].reverse()
  copy.annotations.inactive = reverseRecord(copy.annotations.inactive)
  return copy
}

const EDITABLE_TYPES = new Set(['short-input', 'long-input', 'combobox'])

/** Every single-line, token-free text param a user could retype, as (block, param) pairs. */
function editableParams(workflow: CanonicalWorkflow): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (const block of Object.values(workflow.blocks)) {
    const subBlocks = catalog.blocks[block.type]?.subBlocks ?? []
    for (const [id, param] of Object.entries(block.params)) {
      if (param.kind !== 'value' || typeof param.value !== 'string') continue
      if (!/^[\w .:/-]+$/.test(param.value)) continue
      const subBlock = subBlocks.find((candidate) => candidate.id === id)
      if (subBlock && !EDITABLE_TYPES.has(subBlock.type)) continue
      pairs.push([block.key, id])
    }
  }
  return pairs
}

describe('print determinism', () => {
  it('has enough single-line text params across the cases to exercise one-line edits', () => {
    const total = cases.reduce((sum, testCase) => sum + editableParams(testCase.workflow).length, 0)
    expect(total).toBeGreaterThan(40)
  })

  for (const testCase of cases) {
    describe(testCase.name, () => {
      const first = printWorkflow({
        workflow: testCase.workflow,
        catalog,
        hints: testCase.hints,
        options: { functionCode: 'inline' },
      })
      const text = first.files[0].text

      it('prints byte-identical text for a reordered copy of the same model', () => {
        expect(print(reorder(testCase.workflow), testCase.hints).files[0].text).toBe(text)
      })

      it('reprints identically from the hints its own print returned', () => {
        expect(print(clone(testCase.workflow), first.hints).files[0].text).toBe(text)
      })

      it('changes exactly one line when one text param is edited', () => {
        for (const [blockKey, paramId] of editableParams(testCase.workflow)) {
          const edited = clone(testCase.workflow)
          const param = edited.blocks[blockKey]?.params[paramId]
          if (param?.kind !== 'value' || typeof param.value !== 'string') continue
          const last = param.value.at(-1)
          param.value = `${param.value.slice(0, -1)}${last === 'q' ? 'z' : 'q'}`
          const before = text.split('\n')
          const after = print(edited, first.hints).files[0].text.split('\n')
          expect(after.length, `${blockKey}.${paramId}`).toBe(before.length)
          const changed = after.filter((lineText, index) => lineText !== before[index])
          expect(changed, `${blockKey}.${paramId}`).toHaveLength(1)
        }
      })
    })
  }
})
