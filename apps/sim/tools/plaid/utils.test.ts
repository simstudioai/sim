/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { extractErrorMessage } from '@/tools/error-extractors'
import {
  buildPlaidHeaders,
  mapPlaidAccount,
  mapPlaidNumbers,
  mapPlaidTransaction,
  plaidRecord,
  plaidUrl,
  splitPlaidList,
  toPlaidOptionalBoolean,
  toPlaidOptionalNumber,
} from '@/tools/plaid/utils'

describe('plaidUrl', () => {
  it('uses the sandbox host only when the environment is sandbox', () => {
    expect(plaidUrl({ environment: 'sandbox' }, '/item/get')).toBe(
      'https://sandbox.plaid.com/item/get'
    )
    expect(plaidUrl({ environment: ' Sandbox ' }, '/item/get')).toBe(
      'https://sandbox.plaid.com/item/get'
    )
  })

  it('defaults to production for missing or unknown environments', () => {
    expect(plaidUrl({}, '/accounts/get')).toBe('https://production.plaid.com/accounts/get')
    expect(plaidUrl({ environment: 'development' }, '/accounts/get')).toBe(
      'https://production.plaid.com/accounts/get'
    )
  })
})

describe('buildPlaidHeaders', () => {
  it('sends trimmed credentials in the Plaid auth headers', () => {
    const headers = buildPlaidHeaders({ clientId: ' client ', secret: ' shh ' })
    expect(headers['PLAID-CLIENT-ID']).toBe('client')
    expect(headers['PLAID-SECRET']).toBe('shh')
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['Plaid-Version']).toBe('2020-09-14')
  })
})

describe('splitPlaidList', () => {
  it('splits a comma-separated list, trimming and dropping empty entries', () => {
    expect(splitPlaidList('US, GB ,,FR')).toEqual(['US', 'GB', 'FR'])
  })

  it('returns undefined for empty or blank input', () => {
    expect(splitPlaidList(undefined)).toBeUndefined()
    expect(splitPlaidList('')).toBeUndefined()
    expect(splitPlaidList(' , ')).toBeUndefined()
  })

  it('tolerates an array arriving from an LLM tool call', () => {
    expect(splitPlaidList(['US', ' GB '])).toEqual(['US', 'GB'])
  })
})

describe('plaidRecord', () => {
  it('rejects a non-JSON success body', async () => {
    await expect(plaidRecord(new Response('not json', { status: 200 }), 'item')).rejects.toThrow(
      /not valid JSON/
    )
  })

  it('rejects a non-object payload', async () => {
    await expect(plaidRecord(new Response('[]', { status: 200 }), 'item')).rejects.toThrow(
      /did not return a valid item object/
    )
  })

  it('returns the parsed record for an object payload', async () => {
    await expect(
      plaidRecord(new Response('{"request_id":"req_1"}', { status: 200 }), 'item')
    ).resolves.toEqual({ request_id: 'req_1' })
  })
})

describe('toPlaidOptionalNumber', () => {
  it('passes through numbers and coerces numeric strings', () => {
    expect(toPlaidOptionalNumber(100, 'count')).toBe(100)
    expect(toPlaidOptionalNumber('250', 'count')).toBe(250)
    expect(toPlaidOptionalNumber(0, 'count')).toBe(0)
  })

  it('drops null, undefined, and blank strings', () => {
    expect(toPlaidOptionalNumber(null, 'count')).toBeUndefined()
    expect(toPlaidOptionalNumber(undefined, 'count')).toBeUndefined()
    expect(toPlaidOptionalNumber('  ', 'count')).toBeUndefined()
  })

  it('throws on non-numeric input instead of sending it to Plaid', () => {
    expect(() => toPlaidOptionalNumber('abc', 'count')).toThrow('count must be a valid number')
  })
})

describe('toPlaidOptionalBoolean', () => {
  it('passes booleans through and coerces string forms', () => {
    expect(toPlaidOptionalBoolean(true)).toBe(true)
    expect(toPlaidOptionalBoolean('true')).toBe(true)
    expect(toPlaidOptionalBoolean(' true ')).toBe(true)
    expect(toPlaidOptionalBoolean('false')).toBe(false)
  })

  it('drops null and undefined', () => {
    expect(toPlaidOptionalBoolean(null)).toBeUndefined()
    expect(toPlaidOptionalBoolean(undefined)).toBeUndefined()
  })
})

describe('mapPlaidTransaction', () => {
  it('maps documented fields and nulls absent nullable ones', () => {
    const mapped = mapPlaidTransaction({
      transaction_id: 'txn_1',
      account_id: 'acc_1',
      amount: 12.5,
      iso_currency_code: 'USD',
      date: '2026-08-01',
      name: 'COFFEE SHOP',
      merchant_name: 'Coffee Shop',
      payment_channel: 'in store',
      pending: false,
      personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_COFFEE' },
      location: { city: 'Oakland', lat: 37.8 },
      counterparties: [{ name: 'Coffee Shop', type: 'merchant' }],
    })

    expect(mapped.transaction_id).toBe('txn_1')
    expect(mapped.amount).toBe(12.5)
    expect(mapped.merchant_name).toBe('Coffee Shop')
    expect(mapped.personal_finance_category).toEqual({
      primary: 'FOOD_AND_DRINK',
      detailed: 'FOOD_AND_DRINK_COFFEE',
      confidence_level: null,
    })
    expect(mapped.location?.city).toBe('Oakland')
    expect(mapped.location?.address).toBeNull()
    expect(mapped.counterparties).toHaveLength(1)
    expect(mapped.datetime).toBeNull()
    expect(mapped.pending_transaction_id).toBeNull()
    expect(mapped.original_description).toBeNull()
  })

  it('tolerates malformed entries without throwing', () => {
    const mapped = mapPlaidTransaction('garbage')
    expect(mapped.transaction_id).toBe('')
    expect(mapped.amount).toBe(0)
    expect(mapped.counterparties).toEqual([])
    expect(mapped.location).toBeNull()
  })
})

describe('mapPlaidAccount', () => {
  it('maps balances with nulls where the institution does not report values', () => {
    const mapped = mapPlaidAccount({
      account_id: 'acc_1',
      name: 'Checking',
      official_name: null,
      mask: '0000',
      type: 'depository',
      subtype: 'checking',
      balances: { available: 100.5, current: 110, iso_currency_code: 'USD' },
    })

    expect(mapped.account_id).toBe('acc_1')
    expect(mapped.balances.available).toBe(100.5)
    expect(mapped.balances.limit).toBeNull()
    expect(mapped.official_name).toBeNull()
    expect(mapped.verification_status).toBeNull()
  })

  it('normalizes the documented empty-string verification_status to null', () => {
    const mapped = mapPlaidAccount({ account_id: 'acc_1', verification_status: '' })
    expect(mapped.verification_status).toBeNull()
  })
})

describe('mapPlaidNumbers', () => {
  it('maps every scheme and keeps unused schemes as empty arrays', () => {
    const mapped = mapPlaidNumbers({
      ach: [{ account_id: 'acc_1', account: '1111222233330000', routing: '011401533' }],
      bacs: [{ account_id: 'acc_2', account: '31926819', sort_code: '601613' }],
    })

    expect(mapped.ach).toEqual([
      {
        account_id: 'acc_1',
        account: '1111222233330000',
        routing: '011401533',
        wire_routing: null,
        is_tokenized_account_number: null,
      },
    ])
    expect(mapped.bacs[0].sort_code).toBe('601613')
    expect(mapped.eft).toEqual([])
    expect(mapped.international).toEqual([])
  })

  it('preserves the tokenized-account-number discriminator', () => {
    const mapped = mapPlaidNumbers({
      ach: [
        {
          account_id: 'acc_1',
          account: '4111111111111111',
          routing: '021000021',
          is_tokenized_account_number: true,
        },
      ],
    })
    expect(mapped.ach[0].is_tokenized_account_number).toBe(true)
  })
})

describe('plaid error extractor', () => {
  it('prefers error_message and appends the programmatic error_code', () => {
    const message = extractErrorMessage(
      {
        status: 400,
        data: {
          error_type: 'ITEM_ERROR',
          error_code: 'ITEM_LOGIN_REQUIRED',
          error_message: 'the login details of this item have changed',
          display_message: null,
        },
      },
      'plaid-errors'
    )
    expect(message).toBe('the login details of this item have changed (ITEM_LOGIN_REQUIRED)')
  })

  it('falls back to display_message, then the bare code', () => {
    expect(
      extractErrorMessage(
        { status: 400, data: { error_code: 'X', error_message: '', display_message: 'Try again' } },
        'plaid-errors'
      )
    ).toBe('Try again (X)')
    expect(
      extractErrorMessage({ status: 400, data: { error_code: 'RATE_LIMIT' } }, 'plaid-errors')
    ).toBe('RATE_LIMIT')
  })

  it('falls back to the generic message when the envelope is absent', () => {
    expect(extractErrorMessage({ status: 500, data: {} }, 'plaid-errors')).toBe(
      'Request failed with status 500'
    )
  })
})
