import { describe, expect, it } from 'vitest'
import { QuickBooksBlock } from '@/blocks/blocks/quickbooks'
import { getTrigger } from '@/triggers'
import {
  isQuickBooksEventMatch,
  QUICKBOOKS_TRIGGER_DEFINITIONS,
  quickBooksEventTypesSubBlockId,
  quickBooksTriggerOptions,
} from '@/triggers/quickbooks/quickbooks'

describe('QuickBooks triggers', () => {
  it('keeps trigger definitions, dropdown options, and block access in parity', () => {
    const ids = QUICKBOOKS_TRIGGER_DEFINITIONS.map(({ id }) => id)
    expect(quickBooksTriggerOptions.map(({ id }) => id)).toEqual(ids)
    expect(QuickBooksBlock.triggers?.available).toEqual([
      'quickbooks_invoice_events',
      ...ids.filter((id) => id !== 'quickbooks_invoice_events'),
    ])
    expect(ids).toHaveLength(29)
    expect(
      QUICKBOOKS_TRIGGER_DEFINITIONS.reduce((total, definition) => {
        return total + definition.actions.length
      }, 0)
    ).toBe(101)
    for (const id of ids) expect(getTrigger(id).id).toBe(id)
  })

  it('uses one primary trigger dropdown and entity-specific event selectors', () => {
    const triggerIds = [
      'quickbooks_invoice_events',
      ...QUICKBOOKS_TRIGGER_DEFINITIONS.map(({ id }) => id).filter(
        (id) => id !== 'quickbooks_invoice_events'
      ),
    ]
    expect(
      getTrigger('quickbooks_invoice_events').subBlocks.filter(
        (subBlock) => subBlock.id === 'selectedTriggerId'
      )
    ).toHaveLength(1)
    for (const definition of QUICKBOOKS_TRIGGER_DEFINITIONS) {
      const trigger = getTrigger(definition.id)
      const eventTypes = trigger.subBlocks.find(
        (subBlock) => subBlock.id === quickBooksEventTypesSubBlockId(definition.id)
      )
      if (definition.id === 'quickbooks_preferences_updated') {
        expect(eventTypes).toBeUndefined()
      } else {
        expect(eventTypes?.options?.map((option) => option.id)).toEqual(definition.actions)
        expect(eventTypes?.multiSelect).toBe(true)
      }
      const instructions = trigger.subBlocks.find((subBlock) =>
        subBlock.id.startsWith('triggerInstructions')
      )?.defaultValue
      expect(instructions).toContain('enable the <strong>CloudEvents</strong> payload format')
      if (definition.id === 'quickbooks_preferences_updated') {
        expect(instructions).not.toContain('Select the <strong>Preferences Updated</strong>')
      }
      expect(trigger.outputs).toEqual(getTrigger('quickbooks_invoice_events').outputs)
    }

    const eventTypeIds = QuickBooksBlock.subBlocks
      .map((subBlock) => subBlock.id)
      .filter((id) => id.startsWith('eventTypes_quickbooks_'))
    expect(eventTypeIds).toHaveLength(28)
    expect(new Set(eventTypeIds).size).toBe(eventTypeIds.length)

    for (const sharedFieldId of ['triggerCredentials', 'quickBooksWebhookAppKey']) {
      const sharedFields = QuickBooksBlock.subBlocks.filter(
        (subBlock) => subBlock.id === sharedFieldId
      )
      expect(sharedFields).toHaveLength(1)
      expect(sharedFields[0].condition).toEqual({
        field: 'selectedTriggerId',
        value: triggerIds,
      })
    }

    const webhookUrlFields = QuickBooksBlock.subBlocks.filter((subBlock) =>
      subBlock.id.startsWith('webhookUrlDisplay_quickbooks_')
    )
    expect(webhookUrlFields).toHaveLength(29)
    for (const webhookUrlField of webhookUrlFields) {
      expect(webhookUrlField.providerWebhookUrl).toEqual({
        providerPath: 'quickbooks',
        routingKeySubBlockId: 'quickBooksWebhookAppKey',
      })
    }
  })

  it('matches all 101 supported combinations and rejects unsupported actions', () => {
    for (const definition of QUICKBOOKS_TRIGGER_DEFINITIONS) {
      for (const action of definition.actions) {
        const providerAction = action === 'voided' ? 'void' : action
        expect(
          isQuickBooksEventMatch(
            definition.id,
            `qbo.${definition.entity}.${providerAction}.v1`,
            definition.actions
          )
        ).toBe(true)
      }
      expect(
        isQuickBooksEventMatch(definition.id, `qbo.${definition.entity}.unsupported.v1`, [
          'unsupported',
        ])
      ).toBe(false)
      expect(
        isQuickBooksEventMatch(
          definition.id,
          `qbo.other.${definition.actions[0]}.v1`,
          definition.actions
        )
      ).toBe(false)
    }
    expect(
      isQuickBooksEventMatch('quickbooks_preferences_updated', 'qbo.preferences.updated.v1', null)
    ).toBe(true)
  })
})
