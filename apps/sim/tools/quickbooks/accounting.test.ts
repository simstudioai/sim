import { resetEnvMock, setEnv } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QuickBooksBlock } from '@/blocks/blocks/quickbooks'
import {
  quickbooksCreateDepositTool,
  quickbooksCreateJournalEntryTool,
  quickbooksReadAccountingTransactionsTool,
  quickbooksUpdateDepositTool,
  quickbooksUpdateJournalEntryTool,
} from '@/tools/quickbooks'
import {
  buildQuickBooksCreateDepositBody,
  buildQuickBooksCreateJournalEntryBody,
  buildQuickBooksUpdateDepositBody,
  buildQuickBooksUpdateJournalEntryBody,
  parseQuickBooksDepositLines,
  parseQuickBooksJournalLines,
} from '@/tools/quickbooks/accounting_utils'
import type {
  QuickBooksCreateDepositParams,
  QuickBooksCreateJournalEntryParams,
  QuickBooksReadAccountingTransactionsParams,
} from '@/tools/quickbooks/types'

const authParams = { accessToken: 'access-token', realmId: '123456789' }
const journalLines = [
  { postingType: 'debit' as const, amount: 100, accountId: '7', description: 'Sanitized debit' },
  { postingType: 'credit' as const, amount: 100, accountId: '35' },
]
const depositLines = [{ amount: 100, accountId: '7', description: 'Sanitized source' }]

beforeEach(() => setEnv({ QUICKBOOKS_ENV: 'sandbox' }))
afterEach(resetEnvMock)

describe('QuickBooks accounting reader', () => {
  const listParams: QuickBooksReadAccountingTransactionsParams = {
    ...authParams,
    transactionType: 'journal_entry',
    readMode: 'list',
    startPosition: 2,
    maxResults: 25,
  }

  it.each([
    ['journal_entry', 'JournalEntry', 'journalentry'],
    ['deposit', 'Deposit', 'deposit'],
    ['transfer', 'Transfer', 'transfer'],
  ] as const)('maps %s to fixed list and by-ID contracts', (transactionType, entity, resource) => {
    const requestUrl = quickbooksReadAccountingTransactionsTool.request.url as (
      params: QuickBooksReadAccountingTransactionsParams
    ) => string
    const listUrl = new URL(requestUrl({ ...listParams, transactionType }))
    expect(listUrl.pathname).toBe('/v3/company/123456789/query')
    expect(listUrl.searchParams.get('query')).toBe(
      `SELECT * FROM ${entity} STARTPOSITION 2 MAXRESULTS 25`
    )
    expect(listUrl.searchParams.get('minorversion')).toBe('75')

    const byIdUrl = new URL(
      requestUrl({
        ...listParams,
        transactionType,
        readMode: 'by_id',
        transactionId: ' A/B ',
      })
    )
    expect(byIdUrl.pathname).toBe(`/v3/company/123456789/${resource}/A%2FB`)
  })

  it('preserves native list and by-ID records', async () => {
    await expect(
      quickbooksReadAccountingTransactionsTool.transformResponse!(
        Response.json({
          QueryResponse: {
            JournalEntry: [{ Id: '12', SyncToken: '1', Adjustment: false }],
            startPosition: 2,
            maxResults: 1,
          },
          time: 'test-time',
        }),
        listParams
      )
    ).resolves.toMatchObject({
      output: {
        transactionType: 'journal_entry',
        items: [{ Id: '12', SyncToken: '1', Adjustment: false }],
        nextStartPosition: 3,
        hasMore: false,
      },
    })

    await expect(
      quickbooksReadAccountingTransactionsTool.transformResponse!(
        Response.json({ Transfer: { Id: 'A/B', SyncToken: '0', Amount: 25 } }),
        { ...listParams, transactionType: 'transfer', readMode: 'by_id', transactionId: 'A/B' }
      )
    ).resolves.toMatchObject({
      output: { transactionType: 'transfer', item: { Id: 'A/B', Amount: 25 } },
    })
  })

  it('rejects unsupported types, modes, missing IDs, and malformed wrappers', async () => {
    const requestUrl = quickbooksReadAccountingTransactionsTool.request.url as (
      params: QuickBooksReadAccountingTransactionsParams
    ) => string
    expect(() => requestUrl({ ...listParams, readMode: 'by_id' })).toThrow('transaction ID')
    expect(() =>
      requestUrl({
        ...listParams,
        transactionType:
          'unsupported' as QuickBooksReadAccountingTransactionsParams['transactionType'],
      })
    ).toThrow('transaction type')
    expect(() =>
      requestUrl({
        ...listParams,
        readMode: 'unsupported' as QuickBooksReadAccountingTransactionsParams['readMode'],
      })
    ).toThrow('read mode')
    await expect(
      quickbooksReadAccountingTransactionsTool.transformResponse!(
        Response.json({ QueryResponse: { JournalEntry: [null] } }),
        listParams
      )
    ).rejects.toThrow('malformed JournalEntry record')
  })
})

describe('QuickBooks accounting line validation', () => {
  it('builds balanced journal lines and optional entities', () => {
    const parsed = parseQuickBooksJournalLines([
      { ...journalLines[0], entityType: 'customer', entityId: '42' },
      journalLines[1],
    ])
    expect(parsed?.[0]).toMatchObject({ entityType: 'customer', entityId: '42' })
    expect(
      buildQuickBooksCreateJournalEntryBody({
        ...authParams,
        lines: parsed!,
        confirmPosting: true,
      })
    ).toMatchObject({
      Line: [
        {
          Amount: 100,
          DetailType: 'JournalEntryLineDetail',
          JournalEntryLineDetail: {
            PostingType: 'Debit',
            AccountRef: { value: '7' },
            Entity: { Type: 'Customer', EntityRef: { value: '42' } },
          },
        },
        {
          Amount: 100,
          JournalEntryLineDetail: { PostingType: 'Credit', AccountRef: { value: '35' } },
        },
      ],
    })
  })

  it('rejects unbalanced, malformed, unpaired-entity, and oversized journal lines', () => {
    expect(() => parseQuickBooksJournalLines([journalLines[0]])).toThrow('at least 2 lines')
    expect(() =>
      parseQuickBooksJournalLines([{ ...journalLines[0] }, { ...journalLines[1], amount: 99 }])
    ).toThrow('must balance')
    expect(() =>
      parseQuickBooksJournalLines([{ ...journalLines[0], entityType: 'vendor' }, journalLines[1]])
    ).toThrow('supplied together')
    expect(() =>
      parseQuickBooksJournalLines([{ ...journalLines[0], raw: true }, journalLines[1]])
    ).toThrow('unsupported field')
    expect(() =>
      parseQuickBooksJournalLines([
        { ...journalLines[0], amount: '0.10000000000000001' },
        { ...journalLines[1], amount: '0.1' },
      ])
    ).toThrow('more than two decimal places')
    expect(() =>
      parseQuickBooksJournalLines([
        { ...journalLines[0], amount: '90071992547409.91' },
        { ...journalLines[1], amount: '90071992547409.91' },
      ])
    ).toThrow('safely supported amount range')
    expect(() =>
      parseQuickBooksJournalLines(
        Array.from({ length: 102 }, (_, index) => ({
          postingType: index % 2 === 0 ? 'debit' : 'credit',
          amount: 1,
          accountId: '7',
        }))
      )
    ).toThrow('more than 100')
  })

  it('builds bounded account-based deposit lines and rejects invalid input', () => {
    expect(parseQuickBooksDepositLines(JSON.stringify(depositLines))).toEqual(depositLines)
    const params: QuickBooksCreateDepositParams = {
      ...authParams,
      depositAccountId: '35',
      lines: depositLines,
    }
    expect(buildQuickBooksCreateDepositBody(params)).toEqual({
      DepositToAccountRef: { value: '35' },
      Line: [
        {
          Amount: 100,
          Description: 'Sanitized source',
          DetailType: 'DepositLineDetail',
          DepositLineDetail: { AccountRef: { value: '7' } },
        },
      ],
    })
    expect(() => parseQuickBooksDepositLines('[]')).toThrow('at least 1 line')
    expect(() => parseQuickBooksDepositLines('[{"amount":0,"accountId":"7"}]')).toThrow(
      'positive finite'
    )
  })
})

describe('QuickBooks accounting mutations', () => {
  it('requires journal posting confirmation and builds header-only sparse updates', () => {
    const create: QuickBooksCreateJournalEntryParams = {
      ...authParams,
      lines: journalLines,
      confirmPosting: false,
    }
    expect(() => buildQuickBooksCreateJournalEntryBody(create)).toThrow('Confirm posting')
    expect(
      buildQuickBooksUpdateJournalEntryBody({
        ...authParams,
        journalEntryId: '12',
        syncToken: '1',
        confirmPosting: true,
        privateNote: 'Updated',
      })
    ).toEqual({ Id: '12', SyncToken: '1', sparse: true, PrivateNote: 'Updated' })
    expect(() =>
      buildQuickBooksUpdateJournalEntryBody({
        ...authParams,
        journalEntryId: '12',
        syncToken: '1',
        confirmPosting: true,
      })
    ).toThrow('at least one field')
  })

  it('builds header-only sparse deposit updates and rejects empty updates', () => {
    expect(
      buildQuickBooksUpdateDepositBody({
        ...authParams,
        depositId: '13',
        syncToken: '2',
        transactionDate: '2026-08-01',
      })
    ).toEqual({ Id: '13', SyncToken: '2', sparse: true, TxnDate: '2026-08-01' })
    expect(() =>
      buildQuickBooksUpdateDepositBody({
        ...authParams,
        depositId: '13',
        syncToken: '2',
      })
    ).toThrow('at least one field')
  })

  it.each([
    [quickbooksCreateJournalEntryTool, 'journalentry', 'JournalEntry'],
    [quickbooksCreateDepositTool, 'deposit', 'Deposit'],
  ] as const)('uses one fixed %s create endpoint and wrapper', async (tool, resource, wrapper) => {
    const url = new URL(
      (tool.request.url as (params: Record<string, unknown>) => string)({
        ...authParams,
        requestId: 'request-1',
      })
    )
    expect(url.pathname).toBe(`/v3/company/123456789/${resource}`)
    expect(url.searchParams.get('requestid')).toBe('request-1')
    expect(tool.request.retry).toEqual({ enabled: false })
    expect(tool.postProcess).toBeUndefined()
    await expect(
      tool.transformResponse!(
        Response.json({ [wrapper]: { Id: '12', SyncToken: '0' }, time: 'test-time' })
      )
    ).resolves.toMatchObject({ output: { recordId: '12', syncToken: '0' } })
  })

  it.each([
    [quickbooksUpdateJournalEntryTool, 'journalentry'],
    [quickbooksUpdateDepositTool, 'deposit'],
  ] as const)('uses one fixed %s update endpoint', (tool, resource) => {
    expect(
      new URL((tool.request.url as (params: Record<string, unknown>) => string)(authParams))
        .pathname
    ).toBe(`/v3/company/123456789/${resource}`)
    expect(tool.request.retry).toEqual({ enabled: false })
  })
})

describe('QuickBooks accounting block', () => {
  it('parses accounting JSON and confirmation after dynamic references resolve', () => {
    expect(
      QuickBooksBlock.tools.config!.params!({
        operation: 'quickbooks_create_journal_entry',
        oauthCredential: 'credential-id',
        journalLines: JSON.stringify(journalLines),
        confirmPosting: 'yes',
      })
    ).toMatchObject({ credential: 'credential-id', lines: journalLines, confirmPosting: true })
    expect(
      QuickBooksBlock.tools.config!.params!({
        operation: 'quickbooks_create_deposit',
        oauthCredential: 'credential-id',
        depositAccountId: '35',
        depositLines: JSON.stringify(depositLines),
      })
    ).toMatchObject({
      credential: 'credential-id',
      depositAccountId: '35',
      lines: depositLines,
    })
  })

  it('exposes exactly 39 operations with tool/access parity', () => {
    const operation = QuickBooksBlock.subBlocks.find((subBlock) => subBlock.id === 'operation')
    const operationIds = (operation?.options ?? []).map((option) => option.id)
    expect(operationIds).toHaveLength(39)
    expect(new Set(operationIds).size).toBe(39)
    expect(operationIds).toEqual(QuickBooksBlock.tools.access)
  })

  it('keeps accounting updates header-only and every subblock ID unique', () => {
    expect(new Set(QuickBooksBlock.subBlocks.map((subBlock) => subBlock.id)).size).toBe(
      QuickBooksBlock.subBlocks.length
    )
    for (const operation of ['quickbooks_update_journal_entry', 'quickbooks_update_deposit']) {
      const mapped = QuickBooksBlock.tools.config!.params!({
        operation,
        oauthCredential: 'credential-id',
        transactionId: '12',
        syncToken: '1',
        confirmPosting: 'yes',
        privateNote: 'Updated',
        journalLines: JSON.stringify(journalLines),
        depositLines: JSON.stringify(depositLines),
      }) as Record<string, unknown>
      expect(mapped.lines).toBeUndefined()
    }
  })
})
