import { describe, expect, it } from 'vitest'
import { BrexBlock } from '@/blocks/blocks/brex'
import type { BlockToolParamsContext } from '@/blocks/types'

/** Runs the mapper the way each executor path merges it over the incoming params. */
function runMapper(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  const mapper = BrexBlock.tools.config?.params
  if (!mapper) throw new Error('Brex block has no params mapper')
  return { ...params, ...mapper(params, context) }
}

describe('Brex tool-call mapping', () => {
  it('prefers the block cash account field over the model cash account', () => {
    const sent = runMapper(
      {
        apiKey: 'token',
        accountId: 'acct_block',
        cashAccountId: 'acct_model',
        vendorPaymentInstrumentId: 'pi_1',
        amount: 5000,
        description: 'Invoice 42',
        externalMemo: 'Thanks',
      },
      { operation: 'create_transfer' }
    )
    expect(sent.cashAccountId).toBe('acct_block')
    expect(sent.amount).toBe(5000)
  })

  it('keeps the model cash account on a tool call when the block field is blank', () => {
    const sent = runMapper(
      {
        apiKey: 'token',
        cashAccountId: 'acct_model',
        vendorPaymentInstrumentId: 'pi_1',
        amount: 5000,
        description: 'Invoice 42',
        externalMemo: 'Thanks',
      },
      { operation: 'create_transfer' }
    )
    expect(sent.cashAccountId).toBe('acct_model')
  })

  it('prefers the block spend limit name, period and members over the model args', () => {
    const sent = runMapper(
      {
        apiKey: 'token',
        resourceName: 'Travel',
        name: 'Model name',
        spendLimitPeriodRecurrenceType: 'PER_MONTH',
        periodRecurrenceType: 'PER_YEAR',
        spendLimitMemberUserIds: 'u1,u2',
        memberUserIds: 'u9',
        baseLimitAmount: 1000,
      },
      { operation: 'create_spend_limit' }
    )
    expect(sent).toMatchObject({
      name: 'Travel',
      periodRecurrenceType: 'PER_MONTH',
      memberUserIds: 'u1,u2',
      baseLimitAmount: 1000,
    })
  })

  it('prefers the block vendor email and phone fields over the model args', () => {
    const sent = runMapper(
      { apiKey: 'token', vendorId: 'v1', vendorEmail: 'ap@vendor.com', vendorPhone: '555' },
      { operation: 'update_vendor' }
    )
    expect(sent).toMatchObject({ email: 'ap@vendor.com', phone: '555' })
  })

  it('keeps the model vendor email on a tool call when the block field is blank', () => {
    const sent = runMapper(
      { apiKey: 'token', companyName: 'Acme', email: 'model@vendor.com' },
      { operation: 'create_vendor' }
    )
    expect(sent.email).toBe('model@vendor.com')
  })
})

describe('Brex canvas list filters never reach writes', () => {
  it('drops a saved List Users email filter from a vendor write', () => {
    const sent = runMapper({
      operation: 'update_vendor',
      apiKey: 'token',
      vendorId: 'v1',
      companyName: 'Acme',
      email: 'alice@corp.com',
    })
    expect(sent.email).toBeUndefined()
  })

  it('drops a saved List Spend Limits member filter from a new spend limit', () => {
    const sent = runMapper({
      operation: 'create_spend_limit',
      apiKey: 'token',
      resourceName: 'Travel',
      spendLimitPeriodRecurrenceType: 'PER_MONTH',
      baseLimitAmount: '1000',
      memberUserIds: 'u1,u2',
    })
    expect(sent.memberUserIds).toBeUndefined()
  })
})
