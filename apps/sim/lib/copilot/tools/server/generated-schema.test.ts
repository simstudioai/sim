/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { validateGeneratedToolPayload } from '@/lib/copilot/tools/server/generated-schema'
import { OrchestrationError } from '@/lib/core/orchestration/types'

describe('validateGeneratedToolPayload browser_fill_form parameters', () => {
  it('accepts mixed fields, including empty text and false checked state', () => {
    const payload = {
      fields: [
        { elementId: 0, kind: 'text', text: '' },
        { elementId: 1, kind: 'select', value: 'pro' },
        { elementId: 2, kind: 'checked', checked: false },
      ],
    }
    expect(validateGeneratedToolPayload('browser_fill_form', 'parameters', payload)).toBe(payload)
  })

  it.each([
    { fields: [] },
    {
      fields: Array.from({ length: 9 }, (_, elementId) => ({ elementId, kind: 'text', text: '' })),
    },
    { fields: [{ elementId: 1, kind: 'text' }] },
    { fields: [{ elementId: 1, kind: 'select' }] },
    { fields: [{ elementId: 1, kind: 'checked' }] },
    { fields: [{ elementId: 1, kind: 'text', text: 'a', value: 'a' }] },
    { fields: [{ elementId: 1, kind: 'select', value: 'a', checked: false }] },
    { fields: [{ elementId: 1, kind: 'checked', checked: false, text: '' }] },
    { fields: [{ elementId: 1, kind: 'checked', checked: 'false' }] },
    { fields: [{ elementId: 1, kind: 'text', text: null }] },
    { fields: [{ elementId: 1, kind: 'text', text: '', submit: true }] },
    { fields: [{ elementId: -1, kind: 'text', text: '' }] },
    { fields: [{ elementId: 1.5, kind: 'text', text: '' }] },
    { fields: [{ elementId: Number.MAX_SAFE_INTEGER + 1, kind: 'text', text: '' }] },
    { fields: [{ elementId: 1, kind: 'text', text: 'a'.repeat(4097) }] },
    { fields: [{ elementId: 1, kind: 'select', value: 'a'.repeat(4097) }] },
    { fields: [{ elementId: 1, kind: 'text', text: '' }], submit: true },
  ])('rejects malformed form payload %# through the generated contract', (payload) => {
    expect(() => validateGeneratedToolPayload('browser_fill_form', 'parameters', payload)).toThrow(
      OrchestrationError
    )
  })
})

/**
 * The shapes below are what an agent actually sent when the catalog advertised
 * `updates` as a bare array: the provider-path sanitizer filled the missing
 * `items` with {type: "string"}, so the model produced `["rowId", "data"]` and
 * `[]`, and the executor crashed on the strings. With the item schema synced
 * from the catalog, the router refuses them as a classified input error the
 * model can correct.
 */
describe('validateGeneratedToolPayload table_rows parameters', () => {
  it('rejects string elements in updates as the caller error they are', () => {
    expect(() =>
      validateGeneratedToolPayload('table_rows', 'parameters', {
        operation: 'batch_update_rows',
        args: { tableId: 'tbl_1', updates: ['rowId', 'data'] },
      })
    ).toThrow(OrchestrationError)
    expect(() =>
      validateGeneratedToolPayload('table_rows', 'parameters', {
        operation: 'batch_update_rows',
        args: { tableId: 'tbl_1', updates: ['rowId', 'data'] },
      })
    ).toThrow(/\/args\/updates\/0 must be object/)
  })

  it('rejects an update patch that omits its data object', () => {
    expect(() =>
      validateGeneratedToolPayload('table_rows', 'parameters', {
        operation: 'batch_update_rows',
        args: { tableId: 'tbl_1', updates: [{ rowId: 'row-1' }] },
      })
    ).toThrow(/\/args\/updates\/0 must have required property 'data'/)
  })

  it('rejects a non-object row in batch_insert_rows', () => {
    expect(() =>
      validateGeneratedToolPayload('table_rows', 'parameters', {
        operation: 'batch_insert_rows',
        args: { tableId: 'tbl_1', rows: [{ name: 'Ada' }, 'Bob'] },
      })
    ).toThrow(/\/args\/rows\/1 must be object/)
  })

  it('accepts the documented per-row patch shape', () => {
    const payload = {
      operation: 'batch_update_rows',
      args: { tableId: 'tbl_1', updates: [{ rowId: 'row-1', data: { status: 'active' } }] },
    }
    expect(validateGeneratedToolPayload('table_rows', 'parameters', payload)).toBe(payload)
  })

  it('accepts a sort spec on query_user_table order', () => {
    const payload = {
      operation: 'query_rows',
      args: { tableId: 'tbl_1', order: [{ field: 'age', direction: 'desc' }] },
    }
    expect(validateGeneratedToolPayload('query_user_table', 'parameters', payload)).toBe(payload)
    expect(() =>
      validateGeneratedToolPayload('query_user_table', 'parameters', {
        operation: 'query_rows',
        args: { tableId: 'tbl_1', order: ['age'] },
      })
    ).toThrow(/\/args\/order\/0 must be object/)
  })
})
