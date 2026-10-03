import { describe, expect, it } from 'vitest'
import {
  isQuickBooksEventMatch,
  QUICKBOOKS_TRIGGER_DEFINITIONS,
} from '@/triggers/quickbooks/quickbooks'

describe('QuickBooks triggers', () => {
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
