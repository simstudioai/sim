/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it } from 'vitest'
import { COLUMN_TYPE_REGISTRY } from '@/lib/table/column-types'
import { retypeCellRewrite } from '@/lib/table/columns/service'
import type { ColumnDefinition } from '@/lib/table/types'

const column = (over: Partial<ColumnDefinition>): ColumnDefinition =>
  ({ name: 'col', type: 'string', ...over }) as ColumnDefinition

const sourceDefinition = COLUMN_TYPE_REGISTRY.string
const originalValueForConversion = sourceDefinition.valueForConversion

afterEach(() => {
  if (originalValueForConversion === undefined) {
    Reflect.deleteProperty(sourceDefinition, 'valueForConversion')
    return
  }
  Object.assign(sourceDefinition, { valueForConversion: originalValueForConversion })
})

describe('retypeCellRewrite', () => {
  it('preserves an empty string the target type can hold', () => {
    // `''` is a real stored value: `coerceRowValues` keeps it for `string`, and
    // `json` accepts anything. Nulling it silently destroys the cell — and on a
    // required target leaves a null behind a constraint that just passed,
    // because `countEmptyCells` does not count `''` as empty.
    expect(retypeCellRewrite('', column({ type: 'json' }))).toBeNull()
    expect(retypeCellRewrite('', column({ type: 'json', required: true }))).toBeNull()
    expect(retypeCellRewrite('', column({ type: 'string' }))).toBeNull()
  })

  it('nulls an empty string the target type cannot read', () => {
    expect(retypeCellRewrite('', column({ type: 'number' }))).toEqual({ value: null })
    expect(retypeCellRewrite('', column({ type: 'boolean' }))).toEqual({ value: null })
    expect(retypeCellRewrite('', column({ type: 'date' }))).toEqual({ value: null })
  })

  it('writes back the value the target coercion produces', () => {
    expect(retypeCellRewrite('42', column({ type: 'number' }))).toEqual({ value: 42 })
    expect(retypeCellRewrite(7, column({ type: 'string' }))).toEqual({ value: '7' })
    expect(retypeCellRewrite('true', column({ type: 'boolean' }))).toEqual({ value: true })
  })

  it('writes back null produced by source normalization', () => {
    Object.assign(sourceDefinition, { valueForConversion: () => null })

    expect(
      retypeCellRewrite('stored-value', column({ type: 'number' }), column({ type: 'string' }))
    ).toEqual({ value: null })
  })

  it('coerces source-normalized values into select storage', () => {
    Object.assign(sourceDefinition, { valueForConversion: () => 'Choice' })

    expect(
      retypeCellRewrite(
        'stored-value',
        column({
          type: 'select',
          options: [{ id: 'opt_choice', name: 'Choice' }],
        }),
        column({ type: 'string' })
      )
    ).toEqual({ value: 'opt_choice' })
  })

  it('skips a cell whose stored value already matches the coercion', () => {
    expect(retypeCellRewrite('kept', column({ type: 'json' }))).toBeNull()
    expect(retypeCellRewrite(3, column({ type: 'json' }))).toBeNull()
  })

  it('leaves absent cells alone', () => {
    expect(retypeCellRewrite(null, column({ type: 'string' }))).toBeNull()
    expect(retypeCellRewrite(undefined, column({ type: 'string' }))).toBeNull()
  })
})
