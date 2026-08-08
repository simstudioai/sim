/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getWorkflowSearchSubBlockResourceDefinition,
  parseWorkflowSearchSubBlockResources,
  workflowSearchResourceValueContains,
} from '@/lib/workflows/search-replace/resources/registry'

const TABLE_SUB_BLOCK = { type: 'table-selector' } as const

function replaceTableValue(value: unknown, rawValue: string, replacement: string) {
  const definition = getWorkflowSearchSubBlockResourceDefinition(TABLE_SUB_BLOCK)
  if (!definition) throw new Error('table-selector is not a registered resource selector')
  return definition.codec.replace(value, rawValue, replacement)
}

/**
 * `parse` and `contains` split on commas and trim, so a value carrying stray whitespace is
 * detected as a reference. `replace` must agree, or the reference becomes permanently stuck:
 * it is reported as needing a mapping, yet neither remapping nor clearing can ever touch it.
 */
describe('scalar resource codec whitespace handling', () => {
  const padded = '  tbl_239e870374c14d4a89923175a7b10648  '
  const rawValue = 'tbl_239e870374c14d4a89923175a7b10648'

  it('detects a padded single value as a reference', () => {
    const parsed = parseWorkflowSearchSubBlockResources(padded, TABLE_SUB_BLOCK)
    expect(parsed.map((reference) => reference.rawValue)).toEqual([rawValue])
    expect(
      workflowSearchResourceValueContains(
        { subBlockType: 'table-selector', rawValue } as Parameters<
          typeof workflowSearchResourceValueContains
        >[0],
        padded
      )
    ).toBe(true)
  })

  it('remaps a padded single value to its target', () => {
    expect(replaceTableValue(padded, rawValue, 'tbl_target')).toEqual({
      success: true,
      nextValue: 'tbl_target',
    })
  })

  it('clears a padded single value when the reference is unresolved', () => {
    expect(replaceTableValue(padded, rawValue, '')).toEqual({ success: true, nextValue: '' })
  })

  it('leaves a non-matching single value untouched', () => {
    expect(replaceTableValue('  tbl_other  ', rawValue, 'tbl_target')).toEqual({
      success: true,
      nextValue: '  tbl_other  ',
    })
  })

  it('still remaps an unpadded single value', () => {
    expect(replaceTableValue(rawValue, rawValue, 'tbl_target')).toEqual({
      success: true,
      nextValue: 'tbl_target',
    })
  })

  it('still remaps one entry of a padded multi-value list', () => {
    expect(replaceTableValue(` ${rawValue} , tbl_other `, rawValue, 'tbl_target')).toEqual({
      success: true,
      nextValue: 'tbl_target,tbl_other',
    })
  })
})
