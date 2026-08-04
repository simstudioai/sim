import { describe, expect, it } from 'vitest'
import { QuickBooksBlock } from '@/blocks/blocks/quickbooks'
import { getTrigger } from '@/triggers'
import {
  QUICKBOOKS_TRIGGER_DEFINITIONS,
  quickBooksTriggerOptions,
} from '@/triggers/quickbooks/utils'

describe('QuickBooks triggers', () => {
  it('keeps trigger definitions, dropdown options, and block access in parity', () => {
    const ids = QUICKBOOKS_TRIGGER_DEFINITIONS.map(({ id }) => id)
    expect(quickBooksTriggerOptions.map(({ id }) => id)).toEqual(ids)
    expect(QuickBooksBlock.triggers?.available).toEqual(ids)
    for (const id of ids) expect(getTrigger(id).id).toBe(id)
  })

  it('uses one primary trigger dropdown and entity-specific event selectors', () => {
    expect(
      getTrigger('quickbooks_invoice_events').subBlocks.filter(
        (subBlock) => subBlock.id === 'selectedTriggerId'
      )
    ).toHaveLength(1)
    for (const definition of QUICKBOOKS_TRIGGER_DEFINITIONS) {
      const trigger = getTrigger(definition.id)
      const eventTypes = trigger.subBlocks.find((subBlock) => subBlock.id === 'eventTypes')
      expect(eventTypes?.options?.map((option) => option.id)).toEqual(definition.actions)
      expect(trigger.outputs).toEqual(getTrigger('quickbooks_invoice_events').outputs)
    }
  })
})
