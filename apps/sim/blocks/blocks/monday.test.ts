import { triggersMock } from '@sim/testing/mocks/triggers.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => triggersMock)

import { MondayBlock } from '@/blocks/blocks/monday'
import type { BlockToolParamsContext } from '@/blocks/types'

const mapParams = (
  inputs: Record<string, unknown>,
  context?: BlockToolParamsContext
): Record<string, unknown> => MondayBlock.tools.config?.params?.(inputs, context) ?? {}

/** On an agent call the stored operation reaches the mapper only on `context`, never in the args. */
describe('monday agent tool calls', () => {
  it('maps the update body set on the tool to the create_update body param', () => {
    expect(
      mapParams({ itemId: '1', updateBody: 'Shipped' }, { operation: 'create_update' }).body
    ).toBe('Shipped')
  })

  it('keeps the model body and column value when the tool fields are blank', () => {
    expect(mapParams({ itemId: '1', body: 'Hi' }, { operation: 'create_update' }).body).toBe('Hi')
    expect(
      mapParams(
        { boardId: '1', itemId: '2', columnId: 'status', value: '{"label":"Done"}' },
        { operation: 'change_column_value' }
      ).value
    ).toBe('{"label":"Done"}')
  })

  it('maps the canvas update body exactly as before', () => {
    expect(mapParams({ operation: 'create_update', itemId: '1', updateBody: 'Shipped' }).body).toBe(
      'Shipped'
    )
  })
})
