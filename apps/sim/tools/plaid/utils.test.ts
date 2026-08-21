/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { PLAID_TOOL_REQUEST_MAX_BYTES } from '@/lib/api/contracts/tools/plaid'
import { extractErrorMessage } from '@/tools/error-extractors'
import {
  buildPlaidInternalBody,
  mapPlaidAccount,
  mapPlaidInstitution,
  mapPlaidItem,
  mapPlaidNumbers,
  mapPlaidTransaction,
  parsePlaidCountryCodes,
  parsePlaidProducts,
  plaidRecord,
  splitPlaidList,
  toPlaidOptionalBoolean,
  toPlaidOptionalDateTime,
  toPlaidOptionalNumber,
} from '@/tools/plaid/utils'

describe('buildPlaidInternalBody', () => {
  it('sends only the opaque selected credential ID, operation, and inputs', () => {
    expect(
      buildPlaidInternalBody(
        'plaid_get_accounts',
        { plaidCredentialId: ' credential-1 ' },
        { account_ids: ['acc-1'] }
      )
    ).toEqual({
      operation: 'plaid_get_accounts',
      credentialId: 'credential-1',
      input: { account_ids: ['acc-1'] },
    })
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

  it('accepts selector arrays and rejects non-string list values', () => {
    expect(splitPlaidList(['US', 'GB'])).toEqual(['US', 'GB'])
    expect(() => splitPlaidList(['US', false])).toThrow(
      'Plaid list must be a string or an array of strings'
    )
    expect(() => splitPlaidList({ country: 'US' })).toThrow(
      'Plaid list must be a string or an array of strings'
    )
  })

  it('does not guess provider identifier or list-size limits', () => {
    expect(splitPlaidList('x'.repeat(10_001))).toEqual(['x'.repeat(10_001)])
    expect(splitPlaidList(Array.from({ length: 501 }, (_, index) => `id-${index}`))).toHaveLength(
      501
    )
  })

  it('rejects serialized list values larger than the Plaid tool route can admit', () => {
    expect(() => splitPlaidList('x'.repeat(PLAID_TOOL_REQUEST_MAX_BYTES), 'accountIds')).toThrow(
      `accountIds exceeds the ${PLAID_TOOL_REQUEST_MAX_BYTES}-byte Plaid tool request limit`
    )
    expect(() => splitPlaidList(Array(100_000).fill(''), 'accountIds')).toThrow(
      `accountIds exceeds the ${PLAID_TOOL_REQUEST_MAX_BYTES}-byte Plaid tool request limit`
    )
  })
})

describe('Plaid request enums and formats', () => {
  it('normalizes and validates request country codes', () => {
    expect(parsePlaidCountryCodes(undefined)).toEqual(['US'])
    expect(parsePlaidCountryCodes('us, gb')).toEqual(['US', 'GB'])
    expect(parsePlaidCountryCodes(Array(100).fill('us, GB'))).toEqual(['US', 'GB'])
    expect(() => parsePlaidCountryCodes('ZZ')).toThrow(
      'countryCodes contains unsupported Plaid country code: ZZ'
    )
  })

  it('accepts open-world product identifiers without guessing provider syntax', () => {
    expect(parsePlaidProducts('transactions, AUTH', 'products')).toEqual(['transactions', 'auth'])
    expect(parsePlaidProducts('made_up', 'products')).toEqual(['made_up'])
    expect(parsePlaidProducts('future-product!', 'products')).toEqual(['future-product!'])
  })

  it('accepts RFC3339 date-times with numeric offsets', () => {
    expect(toPlaidOptionalDateTime('2026-08-18T12:30:00-07:00', 'timestamp')).toBe(
      '2026-08-18T12:30:00-07:00'
    )
    expect(() => toPlaidOptionalDateTime('2026-08-18', 'timestamp')).toThrow(
      'timestamp must be an ISO 8601 date-time with a timezone'
    )
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
    expect(() => toPlaidOptionalNumber(false, 'count')).toThrow('count must be a valid number')
    expect(() => toPlaidOptionalNumber(['100'], 'count')).toThrow('count must be a valid number')
  })

  it('enforces integer and range constraints when requested', () => {
    expect(() =>
      toPlaidOptionalNumber('1.5', 'count', { integer: true, min: 1, max: 500 })
    ).toThrow('count must be a whole number')
    expect(() => toPlaidOptionalNumber(0, 'count', { integer: true, min: 1, max: 500 })).toThrow(
      'count must be at least 1'
    )
    expect(() => toPlaidOptionalNumber(501, 'count', { integer: true, min: 1, max: 500 })).toThrow(
      'count must be at most 500'
    )
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

  it('rejects unrecognized boolean values instead of turning them into false', () => {
    expect(() => toPlaidOptionalBoolean('yes')).toThrow(
      'includeOriginalDescription must be true or false'
    )
    expect(() => toPlaidOptionalBoolean(0)).toThrow(
      'includeOriginalDescription must be true or false'
    )
  })
})

describe('mapPlaidTransaction', () => {
  const transaction = {
    transaction_id: 'txn_1',
    account_id: 'acc_1',
    amount: 12.5,
    iso_currency_code: 'USD',
    unofficial_currency_code: null,
    date: '2026-08-01',
    datetime: null,
    authorized_date: null,
    authorized_datetime: null,
    name: 'COFFEE SHOP',
    merchant_name: 'Coffee Shop',
    payment_channel: 'in store',
    pending: false,
    pending_transaction_id: null,
    transaction_code: null,
    location: {
      address: null,
      city: 'Oakland',
      region: null,
      postal_code: null,
      country: null,
      lat: 37.8,
      lon: null,
      store_number: null,
    },
  }

  it('maps documented fields, preserves optional omission, and ignores additive fields', () => {
    const mapped = mapPlaidTransaction({
      ...transaction,
      personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_COFFEE' },
      counterparties: [{ name: 'Coffee Shop', type: 'merchant', logo_url: null, website: null }],
      future_additive_field: { accepted: true },
    })

    expect(mapped.transaction_id).toBe('txn_1')
    expect(mapped.amount).toBe(12.5)
    expect(mapped.merchant_name).toBe('Coffee Shop')
    expect(mapped.personal_finance_category).toEqual({
      primary: 'FOOD_AND_DRINK',
      detailed: 'FOOD_AND_DRINK_COFFEE',
    })
    expect(mapped.location?.city).toBe('Oakland')
    expect(mapped.location?.address).toBeNull()
    expect(mapped.counterparties).toHaveLength(1)
    expect(mapped.datetime).toBeNull()
    expect(mapped.pending_transaction_id).toBeNull()
    expect(mapped).not.toHaveProperty('original_description')
  })

  it('rejects malformed required transaction fields instead of fabricating defaults', () => {
    expect(() => mapPlaidTransaction('garbage')).toThrow('transaction must be an object')
    expect(() => mapPlaidTransaction({ ...transaction, amount: '12.5' })).toThrow(
      'transaction.amount must be a finite number'
    )
    expect(() => mapPlaidTransaction({ ...transaction, pending: 'false' })).toThrow(
      'transaction.pending must be a boolean'
    )
    expect(() => mapPlaidTransaction({ ...transaction, authorized_datetime: undefined })).toThrow(
      'transaction.authorized_datetime must be a string or null'
    )
    expect(() => mapPlaidTransaction({ ...transaction, location: {} })).toThrow(
      'transaction.location.address must be a string or null'
    )
  })
})

describe('mapPlaidAccount', () => {
  const account = {
    account_id: 'acc_1',
    name: 'Checking',
    official_name: null,
    mask: '0000',
    type: 'depository',
    subtype: 'checking',
    balances: {
      available: 100.5,
      current: 110,
      limit: null,
      iso_currency_code: 'USD',
      unofficial_currency_code: null,
    },
  }

  it('maps balances with nulls where the institution does not report values', () => {
    const mapped = mapPlaidAccount(account)

    expect(mapped.account_id).toBe('acc_1')
    expect(mapped.balances.available).toBe(100.5)
    expect(mapped.balances.limit).toBeNull()
    expect(mapped.official_name).toBeNull()
    expect(mapped).not.toHaveProperty('verification_status')
  })

  it('normalizes the documented empty-string verification_status to null', () => {
    const mapped = mapPlaidAccount({ ...account, verification_status: '' })
    expect(mapped.verification_status).toBeNull()
  })

  it('rejects missing or mistyped required account fields', () => {
    expect(() => mapPlaidAccount({ ...account, balances: undefined })).toThrow(
      'account.balances must be an object'
    )
    expect(() => mapPlaidAccount({ ...account, account_id: undefined })).toThrow(
      'account.account_id must be a string'
    )
  })
})

describe('mapPlaidNumbers', () => {
  it('maps every scheme and keeps unused schemes as empty arrays', () => {
    const mapped = mapPlaidNumbers({
      ach: [
        {
          account_id: 'acc_1',
          account: '1111222233330000',
          routing: '011401533',
          wire_routing: null,
        },
      ],
      eft: [],
      international: [],
      bacs: [{ account_id: 'acc_2', account: '31926819', sort_code: '601613' }],
    })

    expect(mapped.ach).toEqual([
      {
        account_id: 'acc_1',
        account: '1111222233330000',
        routing: '011401533',
        wire_routing: null,
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
          wire_routing: null,
          is_tokenized_account_number: true,
        },
      ],
      eft: [],
      international: [],
      bacs: [],
    })
    expect(mapped.ach[0].is_tokenized_account_number).toBe(true)
  })

  it('rejects a missing required scheme instead of treating it as empty', () => {
    expect(() => mapPlaidNumbers({ ach: [], eft: [], international: [] })).toThrow(
      'auth.numbers.bacs must be an array'
    )
  })
})

describe('mapPlaidInstitution', () => {
  it('requires consumed schema fields while accepting additive ones', () => {
    expect(
      mapPlaidInstitution({
        institution_id: 'ins_1',
        name: 'Bank',
        products: ['auth'],
        country_codes: ['US'],
        routing_numbers: [],
        oauth: false,
        future_field: true,
      })
    ).toEqual({
      institution_id: 'ins_1',
      name: 'Bank',
      products: ['auth'],
      country_codes: ['US'],
      routing_numbers: [],
      oauth: false,
    })
    expect(() =>
      mapPlaidInstitution({
        institution_id: 'ins_1',
        name: 'Bank',
        products: [],
        country_codes: [],
        routing_numbers: [],
      })
    ).toThrow('institution.oauth must be a boolean')
  })
})

describe('mapPlaidItem', () => {
  const item = {
    item_id: 'item_1',
    webhook: null,
    error: null,
    available_products: [],
    billed_products: ['transactions'],
    consent_expiration_time: null,
    update_type: 'background',
  }

  it('accepts a null Item error and validates a populated Plaid error envelope', () => {
    expect(mapPlaidItem(item).error).toBeNull()
    expect(
      mapPlaidItem({
        ...item,
        error: {
          error_type: 'ITEM_ERROR',
          error_code: 'ITEM_LOGIN_REQUIRED',
          error_message: 'Login required',
          display_message: null,
          future_field: true,
        },
      }).error
    ).toEqual({
      error_type: 'ITEM_ERROR',
      error_code: 'ITEM_LOGIN_REQUIRED',
      error_message: 'Login required',
      display_message: null,
    })
  })

  it.each(['error_type', 'error_code', 'error_message', 'display_message'])(
    'rejects a populated Item error missing required %s',
    (missingField) => {
      const error: Record<string, unknown> = {
        error_type: 'ITEM_ERROR',
        error_code: 'ITEM_LOGIN_REQUIRED',
        error_message: 'Login required',
        display_message: null,
      }
      delete error[missingField]
      expect(() => mapPlaidItem({ ...item, error })).toThrow(`item.error.${missingField}`)
    }
  )
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
