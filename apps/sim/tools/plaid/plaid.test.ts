/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { PlaidBlock } from '@/blocks/blocks/plaid'
import { plaidSyncTransactionsTool } from '@/tools/plaid/sync_transactions'

const buildParams = PlaidBlock.tools?.config?.params
if (!buildParams) throw new Error('PlaidBlock params transform missing')

const creds = { clientId: 'client_1', secret: 'shh', environment: 'sandbox' }

describe('PlaidBlock tools.config.params', () => {
  it('routes every operation to its snake_case tool id', () => {
    const toolSelector = PlaidBlock.tools?.config?.tool
    expect(toolSelector?.({ operation: 'sync_transactions' })).toBe('plaid_sync_transactions')
    expect(toolSelector?.({ operation: 'create_sandbox_public_token' })).toBe(
      'plaid_create_sandbox_public_token'
    )
  })

  it('forwards environment for every operation except the sandbox token creator', () => {
    const sync = buildParams({ ...creds, operation: 'get_item', accessToken: 'tok' })
    expect(sync.environment).toBe('sandbox')

    const sandbox = buildParams({
      ...creds,
      operation: 'create_sandbox_public_token',
      institutionId: 'ins_109508',
      initialProducts: 'transactions',
    })
    expect(sandbox.environment).toBeUndefined()
    expect(sandbox.institutionId).toBe('ins_109508')
  })

  it('forwards sync fields including the account scope, dropping empty optionals', () => {
    const result = buildParams({
      ...creds,
      operation: 'sync_transactions',
      accessToken: 'tok',
      cursor: '',
      accountId: 'acc_1',
      count: '250',
      daysRequested: '',
      includeOriginalDescription: 'true',
    })
    expect(result.accessToken).toBe('tok')
    expect(result.accountId).toBe('acc_1')
    expect(result.count).toBe(250)
    expect(result.includeOriginalDescription).toBe(true)
    expect(result).not.toHaveProperty('cursor')
    expect(result).not.toHaveProperty('daysRequested')
  })

  it('throws a labeled error on non-numeric page size instead of forwarding NaN', () => {
    expect(() =>
      buildParams({
        ...creds,
        operation: 'sync_transactions',
        accessToken: 'tok',
        count: 'lots',
      })
    ).toThrow('Page Size must be a valid number')
  })
})

describe('plaid_sync_transactions request body', () => {
  const body = plaidSyncTransactionsTool.request.body
  if (!body) throw new Error('sync tool body builder missing')

  it('drops null and empty optionals arriving from LLM tool calls', () => {
    const result = body({
      clientId: 'c',
      secret: 's',
      accessToken: ' tok ',
      cursor: undefined,
      count: null as unknown as number,
      includeOriginalDescription: null as unknown as boolean,
      daysRequested: undefined,
    })
    expect(result).toEqual({ access_token: 'tok' })
  })

  it('coerces string-typed count and boolean, nesting options only when needed', () => {
    const result = body({
      clientId: 'c',
      secret: 's',
      accessToken: 'tok',
      count: '100' as unknown as number,
      includeOriginalDescription: 'true' as unknown as boolean,
    })
    expect(result).toEqual({
      access_token: 'tok',
      count: 100,
      options: { include_original_description: true },
    })
  })

  it('throws on garbage numeric input instead of sending it to Plaid', () => {
    expect(() =>
      body({
        clientId: 'c',
        secret: 's',
        accessToken: 'tok',
        count: 'abc' as unknown as number,
      })
    ).toThrow('count must be a valid number')
  })
})
