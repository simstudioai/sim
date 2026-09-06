import { describe, expect, it } from 'vitest'
import {
  buildQuickBooksCreateDepositBody,
  buildQuickBooksCreateJournalEntryBody,
  buildQuickBooksUpdateDepositBody,
} from '@/tools/quickbooks/accounting_utils'
import type {
  QuickBooksCreateDepositParams,
  QuickBooksCreateJournalEntryParams,
} from '@/tools/quickbooks/types'

const DEPOSIT: QuickBooksCreateDepositParams = {
  accessToken: 'token',
  realmId: '123',
  quickBooksEnvironment: 'sandbox',
  depositAccountId: 'bank-1',
  lines: [{ amount: 20, accountId: 'account-1' }],
}

const JOURNAL_ENTRY: QuickBooksCreateJournalEntryParams = {
  accessToken: 'token',
  realmId: '123',
  quickBooksEnvironment: 'sandbox',
  confirmPosting: true,
  lines: [
    { postingType: 'debit', amount: 20, accountId: 'account-1' },
    { postingType: 'credit', amount: 20, accountId: 'account-2' },
  ],
}

describe('QuickBooks multicurrency and non-US tax fields on accounting creates', () => {
  it('emits CurrencyRef and GlobalTaxCalculation on a Deposit', () => {
    expect(
      buildQuickBooksCreateDepositBody({
        ...DEPOSIT,
        currencyCode: 'aud',
        globalTaxCalculation: 'NotApplicable',
      })
    ).toMatchObject({
      CurrencyRef: { value: 'AUD' },
      GlobalTaxCalculation: 'NotApplicable',
    })
  })

  it('emits CurrencyRef and GlobalTaxCalculation on a Journal Entry', () => {
    expect(
      buildQuickBooksCreateJournalEntryBody({
        ...JOURNAL_ENTRY,
        currencyCode: 'CAD',
        globalTaxCalculation: 'TaxExcluded',
      })
    ).toMatchObject({
      CurrencyRef: { value: 'CAD' },
      GlobalTaxCalculation: 'TaxExcluded',
    })
  })

  it('rejects NotApplicable on a Journal Entry, which Intuit does not document for it', () => {
    expect(() =>
      buildQuickBooksCreateJournalEntryBody({
        ...JOURNAL_ENTRY,
        globalTaxCalculation: 'NotApplicable',
      })
    ).toThrow('globalTaxCalculation must be one of TaxExcluded, TaxInclusive')
  })

  it('omits both fields when they are not supplied', () => {
    const body = buildQuickBooksCreateDepositBody(DEPOSIT)

    expect(body).not.toHaveProperty('CurrencyRef')
    expect(body).not.toHaveProperty('GlobalTaxCalculation')
  })
})

describe('QuickBooks Deposit sparse update', () => {
  it('updates a single header field without restating the destination account', () => {
    expect(
      buildQuickBooksUpdateDepositBody({
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        depositId: 'deposit-1',
        syncToken: '2',
        privateNote: 'Updated deposit',
      })
    ).toEqual({
      Id: 'deposit-1',
      SyncToken: '2',
      sparse: true,
      PrivateNote: 'Updated deposit',
    })
  })

  it('sends DepositToAccountRef only when a replacement account is supplied', () => {
    expect(
      buildQuickBooksUpdateDepositBody({
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        depositId: 'deposit-1',
        syncToken: '2',
        depositAccountId: 'bank-2',
      })
    ).toMatchObject({ DepositToAccountRef: { value: 'bank-2' } })
  })

  it('still refuses an update that would change nothing', () => {
    expect(() =>
      buildQuickBooksUpdateDepositBody({
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        depositId: 'deposit-1',
        syncToken: '2',
      })
    ).toThrow('Provide at least one field to update')
  })
})
