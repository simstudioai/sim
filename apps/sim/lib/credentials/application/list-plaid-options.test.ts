/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { plaidAccountMatchesEligibility } from '@/lib/credentials/application/list-plaid-options'
import type { PlaidAccount } from '@/tools/plaid/types'

function account(type: string, subtype: string | null): PlaidAccount {
  return {
    account_id: `${type}-${subtype}`,
    name: 'Account',
    official_name: null,
    mask: null,
    type,
    subtype,
    balances: {
      available: null,
      current: null,
      limit: null,
      iso_currency_code: null,
      unofficial_currency_code: null,
    },
  }
}

describe('Plaid account selector eligibility', () => {
  it.each([
    ['depository', 'checking', true],
    ['depository', 'savings', true],
    ['depository', 'cash management', true],
    ['depository', 'money market', false],
    ['credit', 'credit card', false],
  ] as const)('filters Auth account %s/%s', (type, subtype, eligible) => {
    expect(plaidAccountMatchesEligibility(account(type, subtype), 'auth')).toBe(eligible)
  })

  it.each([
    ['depository', 'checking', true],
    ['credit', 'credit card', true],
    ['loan', 'student', true],
    ['loan', 'mortgage', true],
    ['loan', 'auto', false],
    ['investment', 'brokerage', false],
  ] as const)('filters Transactions account %s/%s', (type, subtype, eligible) => {
    expect(plaidAccountMatchesEligibility(account(type, subtype), 'transactions')).toBe(eligible)
  })

  it('retains all linked accounts for unfiltered operations', () => {
    expect(plaidAccountMatchesEligibility(account('investment', 'brokerage'), 'all')).toBe(true)
  })
})
